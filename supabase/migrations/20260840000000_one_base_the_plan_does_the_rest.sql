-- ============================================================================
-- Migration 192 — one base for every ad, and the plan decides the rest
--
-- Operator, 2026-08-12: *"dont let me decide what a point is worth by an ad.
-- use what is already promised on the plan, so once i set an ad the tier will
-- know what to pay based on the user amount paid within the tier range. the
-- free ad is already 100 points."*
--
-- Right, and it removes a whole class of mistake. What an ad paid was the
-- PRODUCT of two numbers the operator set in different places on different
-- days: the ad's own `points_reward` and the plan's multiplier. The pool held
-- ads at 30, 40, 80 and 100, so a Platinum member watching a 30-point ad was
-- paid less than a Bronze member watching a 100-point one — the plan ladder
-- said one thing and the feed did another.
--
-- Now there is ONE base, `base_ad_points`, and it is the free plan's per-ad
-- value: 100 points, which is what the free plan has always promised at ×1.
-- Every other plan is that base times the rate their money bought, which is
-- exactly the promise on the upgrade screen and in the PDF.
--
-- ── WHAT HAPPENS TO `ads.points_reward` ──
--
-- The column stays, because dropping it would take four screens and a NOT NULL
-- constraint with it, and because history is worth keeping. It stops being
-- read for payment, and `admin_save_ad` now writes the platform base into it
-- on every save, so a row can never again claim a price the feed will not pay.
-- A column that quietly disagrees with reality is worse than one that is
-- redundant.
--
-- ── AND TWO SCREENS STOP GUESSING ──
--
-- The landing page took the COMMONEST value in the pool and the upgrade screen
-- took the MEDIAN, both to answer "what does an ad pay before the multiplier".
-- Neither had an answer when the pool was empty, and neither agreed with the
-- other when prices differed. They read the config now (in the TypeScript that
-- ships with this migration).
-- ============================================================================

insert into public.app_config (key, value, value_type, description)
select 'base_ad_points', '100', 'int',
       'What one ad pays before any plan multiplier — the free plan''s per-ad '
       || 'value. Every ad pays this base; what a member actually receives is '
       || 'the base times the rate their plan and the amount they paid inside '
       || 'its range earned. Set here rather than on each ad (operator, '
       || '2026-08-12), so an ad cannot promise a figure the ladder does not.'
 where not exists (select 1 from public.app_config where key = 'base_ad_points');

/* Every ad in the pool, brought onto the base. There is one ad live as this
   runs; the rest were cleared earlier today. */
update public.ads
   set points_reward = coalesce(public.config_int('base_ad_points'), 100)
 where points_reward is distinct from coalesce(public.config_int('base_ad_points'), 100);

alter table public.ads alter column points_reward set default 100;


-- ---------------------------------------------------------------------------
-- The base, in one place
-- ---------------------------------------------------------------------------

create or replace function public.base_ad_points()
returns bigint
language sql
stable
set search_path = ''
as $$
  select greatest(coalesce(public.config_int('base_ad_points'), 100), 1);
$$;

revoke execute on function public.base_ad_points() from public, anon;
grant execute on function public.base_ad_points() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- The feed and the credit, restated from the LIVE definitions
-- ---------------------------------------------------------------------------
--
-- ⚠️ `pg_get_functiondef` first, as always. One change in each: the base is
-- the platform's, not the ad's. The feed quotes what the credit will pay,
-- which is the only reason both had to move together.

CREATE OR REPLACE FUNCTION public.get_ad_feed(p_user_id uuid, p_format ad_format DEFAULT NULL::ad_format, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, title text, description text, advertiser_name text, format ad_format, points_reward bigint, points_award bigint, video_source video_source, storage_path text, youtube_video_id text, thumbnail_path text, duration_seconds integer, min_watch_seconds integer, question_count integer, graded_count integer, attempts_used integer, attempts_remaining integer, cta_label text, cta_links jsonb, article_body text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller    uuid := (select auth.uid());
  v_retry_cap int := public.config_int('ad_retry_cap')::int;
  v_repeating boolean;
  v_done      int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  /* ⚠️ NO `v_tier` HERE ANY MORE. One multiplier for the whole feed is exactly
     the bug: with stacked plans the rate depends on how many ads have already
     been watched today, so the feed quotes the rate of the NEXT one. */
  select coalesce(d.ads_completed, 0) into v_done
    from public.daily_earning_counters d
   where d.user_id = p_user_id and d.day = public.utc_today();
  v_done := coalesce(v_done, 0);

  v_repeating := public.may_repeat_ads(p_user_id);

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    /* ⚠️ THE PLATFORM BASE, NOT THE AD'S OWN NUMBER (migration 192). The
       column still exists and is kept in step by `admin_save_ad`, but what an
       ad pays is the base times the rate the member's plan bought, and the
       feed must quote the same figure the credit will use. */
    public.base_ad_points(),
    public.ad_reward_points(p_user_id, public.base_ad_points(), v_done),
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
    /* On a repeat the attempt counter starts again: the previous attempts
       belong to the completion that has already been paid, and carrying them
       forward would offer somebody an ad with no tries left. */
    case when v_repeating and coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then 0 else coalesce(s.attempts_used, 0) end,
    case when v_repeating and coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
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
      -- The ordinary case: anything not finished.
      coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
      or (
        /* The fallback: finished ads, but only when nothing else is left AND
           this one may come back. `ad_repeat_ready` owns that rule, and
           `register_ad_view` asks the same function, because a feed that hides
           an ad the write path still accepts is not a rule at all. */
        v_repeating
        and public.ad_repeat_ready(coalesce(s.completed_at, s.updated_at))
      )
    )
  order by
    /* Oldest finished first when repeating, so the ad somebody has just
       watched is the last one to come back. Null for every row in the
       ordinary case, which leaves the weighted draw below in charge. */
    case when v_repeating then coalesce(s.completed_at, s.updated_at) end asc nulls first,
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

CREATE OR REPLACE FUNCTION public.submit_ad_answers(p_user_id uuid, p_ad_id uuid, p_answers jsonb)
 RETURNS ad_answer_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ad          public.ads;
  v_state       public.user_ad_state;
  v_tier        public.tiers;
  v_retry_cap   int;
  v_elapsed     numeric;
  v_min_watch   int;
  v_q           record;
  v_submitted   text;
  v_ok          boolean;
  v_graded      boolean;
  v_all_correct boolean := true;
  v_qcount      int := 0;
  v_visible     int := 0;
  v_first_q     uuid;
  v_points      bigint;
  v_done        int;
  v_entry       public.points_ledger;
  v_balance     bigint;
  v_left        int;
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

    /* ⚠️ THE ANSWER IS WRITTEN DOWN HERE (migration 191), one row per
       question, whether the submission goes on to pass or fail — a wrong
       answer is still an answer, and on a survey there is no such thing as
       wrong. Before this, everything the loop learned was discarded and a
       single `ad_attempts` row carried the whole payload as text against the
       first question's id.

       The wording and the option label are SNAPSHOT: the operator edits
       questions and deletes options, and a report that joined live text would
       rewrite what people were asked. */
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

  /* ⚠️ THE RATE IS NOT THE TIER'S ANY MORE (migration 187). With stacked plans
     each allowance carries the rate its own money bought, best first, so what
     this ad is worth depends on how many have already been watched today. Read
     BEFORE `credit_points`, which is what increments that counter. */
  select coalesce(d.ads_completed, 0) into v_done
    from public.daily_earning_counters d
   where d.user_id = p_user_id and d.day = public.utc_today();

  /* ⚠️ THE BASE COMES FROM THE PLATFORM, NOT THE AD (migration 192). An ad
     used to carry its own worth, so a Platinum member on a 30-point ad was
     paid less than a Bronze member on a 100-point one and the ladder was not
     the promise it looked like. */
  v_points := public.ad_reward_points(p_user_id, public.base_ad_points(), coalesce(v_done, 0));

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
        'tier_slug',         v_tier.slug,
        'tier_multiplier',   v_tier.reward_multiplier,
        /* What THIS ad was paid at, which on a stacked account is not the
           tier's headline rate. Derived rather than re-queried so the number
           in the ledger cannot disagree with the number credited. */
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


-- ---------------------------------------------------------------------------
-- The column cannot drift from the base
-- ---------------------------------------------------------------------------
--
-- A trigger rather than an edit to `admin_save_ad`, for the reason the payout
-- cool-off got one on 2026-08-12: the rule then holds for EVERY writer — that
-- function, a duplicate, a seed script, an admin fixing something by hand —
-- instead of being a line each of them has to remember. `points_reward` is
-- now a mirror of the platform base, never a decision.

create or replace function public.ads_force_base_points()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.points_reward := public.base_ad_points();
  return new;
end;
$$;

drop trigger if exists ads_force_base_points on public.ads;
create trigger ads_force_base_points
  before insert or update on public.ads
  for each row execute function public.ads_force_base_points();
