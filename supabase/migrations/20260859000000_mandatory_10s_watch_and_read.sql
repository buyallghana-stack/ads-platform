-- =============================================================================
-- Migration: 20260859000000_mandatory_10s_watch_and_read
-- Description: Make all video and article (link) ads 10 seconds mandatory watch and read.
-- =============================================================================

-- 1. Update default config for link dwell seconds
UPDATE public.app_config
   SET value = '10',
       description = 'The reading time a new link ad starts with, in seconds (10s mandatory), before its link will pay.'
 WHERE key = 'link_dwell_seconds_default';

-- 2. Update existing video and link (article) ads to 10 seconds min_watch_seconds
UPDATE public.ads
   SET min_watch_seconds = 10
 WHERE format IN ('video', 'link');

-- 3. Update submit_ad_answers function to enforce 10s mandatory watch/read on video and link ads
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

  -- 10 seconds mandatory watch/read for video and article/link ads
  v_min_watch := case
    when v_ad.format in ('video', 'link') then coalesce(v_ad.min_watch_seconds, 10)
    else coalesce(
      v_ad.min_watch_seconds,
      case when v_qcount = 0 then v_ad.duration_seconds else 0 end,
      0
    )
  end;
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
