-- ============================================================================
-- Migration 194 — an ad pays the valuation of the plan it belongs to
--
-- BUG:
-- On the Ads tab, all ads were displaying 173 pts (the Silver valuation)
-- on every ad card, even for ads that were created for Bronze plans or other
-- tiers. Furthermore, when watching and submitting a Bronze ad, it did not
-- credit the Bronze plan's rate.
--
-- ROOT CAUSE:
-- 1. `get_ad_feed` computed `points_award` by calling `ad_reward_points(p_user_id, base, v_done)`.
--    It evaluated this once for `v_done` (e.g. 0) and applied that SAME scalar
--    number to EVERY ad row returned in the query.
--    Because `ad_reward_points` was only checking `user_ad_allowances` (which orders
--    plans best-multiplier first), slot 1 (Silver, ×1.73 = 173 pts) was returned
--    for every row in the feed.
-- 2. `submit_ad_answers` also called `ad_reward_points(p_user_id, base, v_done)`
--    without passing `p_ad_id`, so points credited depended purely on the
--    sequence number of ads watched that day rather than the plan the ad
--    was configured for.
--
-- FIX:
-- 1. Update `ad_reward_points` to take `p_ad_id`:
--    - If the ad is tagged to specific tier(s) in `ad_tiers` (e.g. Bronze or Silver bucket),
--      and the user holds an active subscription for that tier, it uses that
--      specific plan's multiplier (`plan_multiplier_for_amount`).
--    - If untagged or no specific tier match, it falls back to `user_ad_allowances`.
-- 2. Update `get_ad_feed` to pass `a.id` into `ad_reward_points(p_user_id, a.id, base, v_done)`.
-- 3. Update `submit_ad_answers` to pass `p_ad_id` into `ad_reward_points(p_user_id, p_ad_id, base, v_done)`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ad_reward_points with ad tier awareness
-- ---------------------------------------------------------------------------

create or replace function public.ad_reward_points(
  p_user_id uuid,
  p_ad_id   uuid,
  p_base    bigint,
  p_done    int default 0
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_matching_multiplier numeric;
  v_fallback_multiplier numeric;
  v_base                bigint := greatest(coalesce(p_base, 0), 0);
  v_ceiling             numeric := coalesce(
    (select value::numeric from public.app_config where key = 'subscription_max_combined_multiplier'),
    3.500);
begin
  -- 1. If ad is tagged to specific tier(s), check if user holds an active subscription for any of those tiers:
  if p_ad_id is not null then
    select max(least(
             public.plan_multiplier_for_amount(coalesce(s.amount_minor, t.price_minor)),
             v_ceiling
           ))
      into v_matching_multiplier
      from public.user_subscriptions s
      join public.tiers t on t.id = s.tier_id
      join public.ad_tiers atg on atg.tier_id = t.id
     where s.user_id = p_user_id
       and atg.ad_id = p_ad_id
       and not t.is_default
       and (
         (s.status = 'active' and now() < s.current_period_end)
         or
         (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
       );
  end if;

  if v_matching_multiplier is not null then
    return greatest(floor(v_base * v_matching_multiplier)::bigint, 1);
  end if;

  -- 2. Fallback for untagged ads (or ads without matching tier subscription):
  -- Use user_ad_allowances with p_done slice:
  with slices as (
    select a.multiplier,
           sum(a.ads) over (order by a.slot rows between unbounded preceding and current row) as through
      from public.user_ad_allowances(p_user_id) a
  ),
  pick as (
    select multiplier from slices
     where through > greatest(coalesce(p_done, 0), 0)
     order by through
     limit 1
  )
  select coalesce(
    (select multiplier from pick),
    (select min(multiplier) from slices),
    1
  ) into v_fallback_multiplier;

  return greatest(floor(v_base * coalesce(v_fallback_multiplier, 1))::bigint, 1);
end;
$$;

-- Overload for backward compatibility (where p_ad_id is omitted)
create or replace function public.ad_reward_points(
  p_user_id uuid,
  p_base    bigint,
  p_done    int default 0
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select public.ad_reward_points(p_user_id, null::uuid, p_base, p_done);
$$;

revoke execute on function public.ad_reward_points(uuid, uuid, bigint, int) from public, anon;
grant execute on function public.ad_reward_points(uuid, uuid, bigint, int) to authenticated, service_role;

revoke execute on function public.ad_reward_points(uuid, bigint, int) from public, anon;
grant execute on function public.ad_reward_points(uuid, bigint, int) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. get_ad_feed — evaluates each ad's valuation specifically
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_ad_feed(p_user_id uuid, p_format ad_format DEFAULT NULL::ad_format, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, title text, description text, advertiser_name text, format ad_format, points_reward bigint, points_award bigint, video_source video_source, storage_path text, youtube_video_id text, thumbnail_path text, duration_seconds integer, min_watch_seconds integer, question_count integer, graded_count integer, attempts_used integer, attempts_remaining integer, cta_label text, cta_links jsonb, article_body text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller      uuid := (select auth.uid());
  v_retry_cap   int := public.config_int('ad_retry_cap')::int;
  v_repeating   boolean;
  v_repeat_on   boolean;
  v_done        int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(d.ads_completed, 0) into v_done
    from public.daily_earning_counters d
   where d.user_id = p_user_id and d.day = public.utc_today();
  v_done := coalesce(v_done, 0);

  v_repeating := public.may_repeat_ads(p_user_id);
  v_repeat_on := coalesce(public.config_bool('ad_repeat_when_exhausted'), false);

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    public.base_ad_points(),
    -- ⚠️ Pass a.id so each ad reflects its own plan bucket valuation
    public.ad_reward_points(p_user_id, a.id, public.base_ad_points(), v_done),
    a.video_source,
    a.storage_path,
    a.youtube_video_id,
    a.thumbnail_path,
    a.duration_seconds,
    a.min_watch_seconds,
    (select count(*)::int from public.ad_questions q where q.ad_id = a.id),
    (select count(*)::int
       from public.ad_questions q
      where q.ad_id = a.id
        and (
          q.correct_answer is not null
          or exists (select 1 from public.ad_question_options o
                      where o.question_id = q.id and o.is_correct)
        )),
    case when coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then 0 else coalesce(s.attempts_used, 0) end,
    case when coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then v_retry_cap else greatest(v_retry_cap - coalesce(s.attempts_used, 0), 0) end,
    a.cta_label,
    a.cta_links,
    a.article_body
  from public.ads a
  join public.eligible_ad_ids(p_user_id) e on e.ad_id = a.id
  left join public.user_ad_state s
    on s.user_id = p_user_id and s.ad_id = a.id
  where (p_format is null or a.format = p_format)
    and (
      coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
      or (
        v_repeat_on
        and public.ad_repeat_ready(coalesce(s.completed_at, s.updated_at))
      )
    )
  order by
    case when coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then 1 else 0 end,
    case when coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then coalesce(s.completed_at, s.updated_at) end asc nulls first,
    -ln(
      (abs(hashtextextended(
             p_user_id::text || a.id::text || public.utc_today()::text, 0
           )) % 1000000 + 1)::numeric / 1000001.0
    ) / a.weight
  limit greatest(p_limit, 1);
end;
$function$;

revoke execute on function public.get_ad_feed(uuid, public.ad_format, integer) from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, integer) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. submit_ad_answers — credits the ad's true plan bucket valuation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_ad_answers(p_user_id uuid, p_ad_id uuid, p_answers jsonb)
 RETURNS ad_answer_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ad           public.ads;
  v_state        public.user_ad_state;
  v_tier         public.tiers;
  v_ad_tier_slug text;
  v_retry_cap    int;
  v_elapsed      numeric;
  v_min_watch    int;
  v_q            record;
  v_submitted    text;
  v_ok           boolean;
  v_graded       boolean;
  v_all_correct  boolean := true;
  v_qcount       int := 0;
  v_visible      int := 0;
  v_first_q      uuid;
  v_points       bigint;
  v_done         int;
  v_entry        public.points_ledger;
  v_balance      bigint;
  v_left         int;
begin
  v_retry_cap := public.config_int('ad_retry_cap')::int;

  select * into v_state
    from public.user_ad_state s
   where s.user_id = p_user_id and s.ad_id = p_ad_id
   for update;

  if not found then
    return row('not_watched', 0, 0, v_retry_cap, null,
               'No view registered for this ad.')::public.ad_answer_result;
  end if;

  if v_state.status = 'completed' then
    return row('already_completed', 0, v_state.attempts_used, 0, null,
               'This ad has already been completed.')::public.ad_answer_result;
  end if;

  if v_state.status = 'failed_locked' then
    return row('locked', 0, v_state.attempts_used, 0, null,
               'No attempts remaining for this ad.')::public.ad_answer_result;
  end if;

  if v_state.watch_started_at is null then
    return row('not_watched', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'Watch the ad again before answering.')::public.ad_answer_result;
  end if;

  select * into v_ad
    from public.ads a
   where a.id = p_ad_id
     and a.status = 'active'
     and (a.starts_at is null or a.starts_at <= now())
     and (a.ends_at   is null or a.ends_at   >  now())
     and (a.max_completions is null or a.completions_count < a.max_completions);

  if not found then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad is no longer available.')::public.ad_answer_result;
  end if;

  select count(*)::int into v_qcount
    from public.ad_questions q where q.ad_id = p_ad_id;

  v_min_watch := coalesce(
    v_ad.min_watch_seconds,
    case when v_qcount = 0 then v_ad.duration_seconds else 0 end,
    0
  );
  v_elapsed := extract(epoch from (now() - v_state.watch_started_at));

  if v_elapsed < v_min_watch then
    return row('too_fast', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               format('Keep watching — %s more second(s) required.',
                      ceil(v_min_watch - v_elapsed)))::public.ad_answer_result;
  end if;

  for v_q in
    select q.id, q.answer_format, q.correct_answer, q.question_text,
           v.question_position,
           (q.correct_answer is not null
            or exists (select 1 from public.ad_question_options o
                        where o.question_id = q.id and o.is_correct)) as is_graded
      from public.visible_ad_questions(p_ad_id, p_answers) v
      join public.ad_questions q on q.id = v.question_id
     order by v.question_position
  loop
    v_visible := v_visible + 1;
    if v_first_q is null then v_first_q := v_q.id; end if;

    v_submitted := p_answers ->> v_q.id::text;
    v_graded    := v_q.is_graded;
    v_ok        := null;

    if v_submitted is null or length(trim(v_submitted)) = 0 then
      v_all_correct := false;
    elsif not v_graded then
      null;
    elsif v_q.answer_format = 'multiple_choice' then
      select exists (
        select 1 from public.ad_question_options o
         where o.question_id = v_q.id
           and o.id::text = v_submitted
           and o.is_correct
      ) into v_ok;
      v_all_correct := v_all_correct and v_ok;
    else
      v_ok := lower(trim(v_submitted)) = lower(trim(v_q.correct_answer));
      v_all_correct := v_all_correct and v_ok;
    end if;

    insert into public.ad_responses (
      ad_id, question_id, user_id, occasion, attempt_number,
      question_position, question_text, answer_format, is_graded,
      option_id, answer_label, answer_text, is_correct, watch_seconds
    )
    values (
      p_ad_id, v_q.id, p_user_id,
      v_state.times_completed + 1, v_state.attempts_used + 1,
      v_q.question_position, v_q.question_text, v_q.answer_format::text, v_graded,
      case when v_q.answer_format = 'multiple_choice'
                and v_submitted ~ '^[0-9a-fA-F-]{36}$'
           then v_submitted::uuid end,
      case when v_q.answer_format = 'multiple_choice'
           then (select o.option_text from public.ad_question_options o
                  where o.id::text = v_submitted)
           else nullif(trim(coalesce(v_submitted, '')), '') end,
      nullif(trim(coalesce(v_submitted, '')), ''),
      case when v_graded then v_ok end,
      floor(v_elapsed)::int
    );
  end loop;

  if v_qcount > 0 and v_visible = 0 then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad has no answerable questions configured.')::public.ad_answer_result;
  end if;

  if not v_all_correct then
    update public.user_ad_state
       set attempts_used    = attempts_used + 1,
           watch_started_at = null,
           status           = case when attempts_used + 1 >= v_retry_cap
                                   then 'failed_locked'::public.user_ad_status
                                   else 'in_progress'::public.user_ad_status end,
           locked_at        = case when attempts_used + 1 >= v_retry_cap
                                   then now() else null end,
           updated_at       = now()
      where user_id = p_user_id and ad_id = p_ad_id
     returning * into v_state;

    insert into public.ad_attempts (user_id, ad_id, question_id, attempt_number,
                                    submitted_answer, is_correct, watch_seconds)
    values (p_user_id, p_ad_id, v_first_q, v_state.attempts_used,
            left(coalesce(p_answers::text, ''), 4000), false, floor(v_elapsed)::int);

    if v_state.status = 'failed_locked' then
      return row('locked', 0, v_state.attempts_used, 0, null,
                 'Incorrect. No attempts remaining for this ad.')::public.ad_answer_result;
    end if;

    return row('incorrect', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'Incorrect. Watch the ad again to retry.')::public.ad_answer_result;
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

  select coalesce(d.ads_completed, 0) into v_done
    from public.daily_earning_counters d
   where d.user_id = p_user_id and d.day = public.utc_today();

  -- ⚠️ Pass p_ad_id so points awarded match this specific ad's tier valuation
  v_points := public.ad_reward_points(p_user_id, p_ad_id, public.base_ad_points(), coalesce(v_done, 0));

  -- Get the matching tier slug for metadata logging if tagged to a plan
  select t.slug into v_ad_tier_slug
    from public.ad_tiers atg
    join public.tiers t on t.id = atg.tier_id
   where atg.ad_id = p_ad_id
   limit 1;

  update public.ads
     set completions_count = completions_count + 1
   where id = p_ad_id
     and (max_completions is null or completions_count < max_completions);

  if not found then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad just reached its limit.')::public.ad_answer_result;
  end if;

  v_left := greatest(v_retry_cap - v_state.attempts_used, 0);

  begin
    v_entry := public.credit_points(
      p_user_id, v_points,
      case v_ad.format when 'survey' then 'survey'::public.ledger_entry_type
                       else 'ad_view'::public.ledger_entry_type end,
      'ad', public.ad_occasion_ref(p_ad_id, v_state.times_completed + 1),
      jsonb_build_object(
        'ad_title',          v_ad.title,
        'base_points',       public.base_ad_points(),
        'tier_slug',         coalesce(v_ad_tier_slug, v_tier.slug),
        'tier_multiplier',   v_tier.reward_multiplier,
        'ad_multiplier',     round(v_points::numeric / greatest(public.base_ad_points(), 1), 3),
        'ads_done_before',   coalesce(v_done, 0),
        'watch_seconds',     floor(v_elapsed)::int,
        'attempt_number',    v_state.attempts_used + 1,
        'question_count',    v_qcount,
        'questions_shown',   v_visible
      ),
      true
    );
  exception
    when unique_violation then
      update public.user_ad_state
         set status           = 'completed',
             times_completed  = greatest(times_completed, v_state.times_completed + 1),
             completed_at     = coalesce(completed_at, now()),
             watch_started_at = null,
             updated_at       = now()
       where user_id = p_user_id and ad_id = p_ad_id;

      return row('already_completed', 0, v_state.attempts_used, 0, null,
                 'This ad has already been credited to this account.')::public.ad_answer_result;

    when sqlstate 'P0001' or sqlstate '23514' then
      if sqlerrm like '%points cap%' then
        return row('points_cap_reached', 0, v_state.attempts_used, v_left, null,
                   sqlerrm)::public.ad_answer_result;
      elsif sqlerrm like '%Cooldown%' then
        return row('cooldown_active', 0, v_state.attempts_used, v_left, null,
                   sqlerrm)::public.ad_answer_result;
      elsif sqlerrm like '%Daily cap%' then
        return row('daily_cap_reached', 0, v_state.attempts_used, v_left, null,
                   sqlerrm)::public.ad_answer_result;
      end if;
      return row('earning_blocked', 0, v_state.attempts_used, v_left, null,
                 sqlerrm)::public.ad_answer_result;
  end;

  update public.user_ad_state
     set status             = 'completed',
         attempts_used      = attempts_used + 1,
         times_completed    = times_completed + 1,
         completed_at       = now(),
         watch_completed_at = now(),
         watch_started_at   = null,
         updated_at         = now()
   where user_id = p_user_id and ad_id = p_ad_id
  returning * into v_state;

  insert into public.ad_attempts (user_id, ad_id, question_id, attempt_number,
                                  submitted_answer, is_correct, watch_seconds)
  values (p_user_id, p_ad_id, v_first_q, v_state.attempts_used,
          left(coalesce(p_answers::text, ''), 4000), true, floor(v_elapsed)::int);

  select balance into v_balance from public.user_balances where user_id = p_user_id;

  return row('correct', v_points, v_state.attempts_used, 0, v_balance,
             format('%s points added.', v_points))::public.ad_answer_result;
end;
$function$;

revoke execute on function public.submit_ad_answers(uuid, uuid, jsonb) from public, anon;
grant execute on function public.submit_ad_answers(uuid, uuid, jsonb) to service_role;
