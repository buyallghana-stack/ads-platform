-- ============================================================================
-- Migration 040 — Make the points ceilings real, and stop lying about limits
--
-- Two problems, both found by testing the ads tab now that it is live.
--
-- 1. `per_user_daily_points_cap` WAS NOT ENFORCED ANYWHERE.
--
--    It existed as a config row and a comment. No function read it, no
--    application code read it. Its own description calls it a "Hard ceiling on
--    points one user can earn per day regardless of stacked plans" and says it
--    "MUST be set before stacking goes live" — and stacking has been live since
--    migration 035. Setting it would have done nothing at all, which is worse
--    than not having it: the operator would believe a limit was in place.
--
--    It is enforced here, on the earning path only. An admin correcting a
--    balance, a refund, or a referral bonus must not be refused because the
--    user has watched a lot of ads today; the ceiling exists to bound EARNING.
--
--    A credit that would cross the ceiling is refused WHOLE rather than
--    trimmed. A partial reward would be impossible to explain — the user
--    answered correctly and would be paid an amount matching nothing they were
--    shown. Refusal consumes no attempt (submit_ad_answers rolls the whole
--    subtransaction back), so the ad is still there tomorrow.
--
-- 2. Three different refusals were reported to the user as "daily cap".
--
--    submit_ad_answers matched on the text of whatever credit_points raised
--    and returned `daily_cap_reached` for the ad cap, for a cooldown, and now
--    for a points ceiling too. Migration 039 added the missing outcomes; this
--    migration returns them. The match order matters and is deliberate:
--    'points cap' is tested before 'Daily cap' so the more specific message
--    wins.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- credit_points
-- ---------------------------------------------------------------------------
--
-- Restated in full rather than patched, so the money path can be read in one
-- piece. Changes from the previous version are marked NEW.

create or replace function public.credit_points(
  p_user_id uuid,
  p_amount bigint,
  p_entry_type public.ledger_entry_type,
  p_reference_type text default null,
  p_reference_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_enforce_daily_cap boolean default false
)
returns public.points_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier        public.tiers;
  v_rate        bigint;
  v_today       date := public.utc_today();
  v_new_balance bigint;
  v_ceiling     bigint;
  v_issued      bigint;
  v_alerted     timestamptz;
  v_cooldown    int;
  v_disabled    timestamptz;
  v_counter     public.daily_earning_counters;
  v_existing    public.daily_earning_counters;
  v_entry       public.points_ledger;
  v_points_cap  bigint;   -- NEW
  v_pool_now    bigint;   -- NEW
begin
  if p_amount <= 0 then
    raise exception 'credit_points requires a positive amount, got %', p_amount;
  end if;

  if p_entry_type in ('ad_view', 'survey', 'referral_signup', 'referral_activation') then
    select p.disabled_at into v_disabled from public.profiles p where p.id = p_user_id;
    if v_disabled is not null then
      raise exception 'Account is disabled and cannot earn' using errcode = 'check_violation';
    end if;
  end if;

  if public.config_bool('earning_paused_globally') then
    raise exception 'Earning is paused platform-wide' using errcode = 'check_violation';
  end if;

  v_rate := public.config_int('points_per_currency_unit');

  -- NEW: platform-wide reward pool stop.
  --
  -- Checked BEFORE the issuance row is touched, and only when the operator has
  -- switched blocking on. Reading the ceiling first is what keeps the alert:
  -- the credit that FIRST reaches the ceiling still succeeds and writes the
  -- critical alert below, and only the credits after it are refused. Checking
  -- afterwards would roll the alert back along with the credit, and the
  -- operator would never be told why earning stopped.
  if p_enforce_daily_cap then
    v_ceiling := public.config_int('reward_pool_daily_ceiling_points');
    if v_ceiling > 0 and public.config_bool('reward_pool_ceiling_blocks') then
      select points_issued into v_pool_now
        from public.daily_issuance where day = v_today;
      if coalesce(v_pool_now, 0) >= v_ceiling then
        raise exception 'Reward pool daily ceiling of % points reached', v_ceiling
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if p_enforce_daily_cap then
    v_tier := public.resolve_user_tier(p_user_id);

    if v_tier.daily_ad_cap <= 0 then
      raise exception 'Tier % has a daily cap of zero', v_tier.slug using errcode = 'check_violation';
    end if;

    v_cooldown := coalesce(
      nullif(v_tier.ad_cooldown_seconds, 0),
      public.config_int('ad_cooldown_seconds_default')::int
    );

    insert into public.daily_earning_counters (user_id, day, ads_completed, points_earned, last_earned_at)
    values (p_user_id, v_today, 1, p_amount, now())
    on conflict (user_id, day) do update
      set ads_completed  = public.daily_earning_counters.ads_completed + 1,
          points_earned  = public.daily_earning_counters.points_earned + p_amount,
          last_earned_at = now()
      where public.daily_earning_counters.ads_completed < v_tier.daily_ad_cap
        and (
          v_cooldown <= 0
          or public.daily_earning_counters.last_earned_at is null
          or now() - public.daily_earning_counters.last_earned_at >= make_interval(secs => v_cooldown)
        )
    returning * into v_counter;

    if not found then
      select * into v_existing
        from public.daily_earning_counters
       where user_id = p_user_id and day = v_today;

      if v_existing.ads_completed >= v_tier.daily_ad_cap then
        raise exception 'Daily cap of % reached', v_tier.daily_ad_cap
          using errcode = 'check_violation';
      else
        raise exception 'Cooldown active: % seconds required between ads', v_cooldown
          using errcode = 'check_violation';
      end if;
    end if;

    -- NEW: the per-user points ceiling.
    --
    -- The ad cap above bounds how MANY ads a user may watch; this bounds how
    -- much they may be PAID for them. They are not the same limit once plans
    -- stack: four stacked plans multiply both the allowance and the rate, so a
    -- count-based cap alone cannot bound the daily cost of one account.
    --
    -- v_counter.points_earned already includes this credit, so the comparison
    -- is "would this credit take them over" and the raise unwinds it.
    v_points_cap := public.config_int('per_user_daily_points_cap');
    if v_points_cap > 0 and v_counter.points_earned > v_points_cap then
      raise exception 'Daily points cap of % reached', v_points_cap
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.user_balances (user_id, balance, lifetime_earned, updated_at)
  values (p_user_id, p_amount, p_amount, now())
  on conflict (user_id) do update
    set balance         = public.user_balances.balance + p_amount,
        lifetime_earned = public.user_balances.lifetime_earned + p_amount,
        updated_at      = now()
  returning balance into v_new_balance;

  insert into public.points_ledger (
    user_id, entry_type, amount, balance_after,
    reference_type, reference_id, points_per_currency_unit, metadata
  )
  values (
    p_user_id, p_entry_type, p_amount, v_new_balance,
    p_reference_type, p_reference_id, v_rate, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_entry;

  insert into public.daily_issuance (day, points_issued, updated_at)
  values (v_today, p_amount, now())
  on conflict (day) do update
    set points_issued = public.daily_issuance.points_issued + p_amount,
        updated_at    = now()
  returning points_issued, ceiling_alerted_at into v_issued, v_alerted;

  v_ceiling := public.config_int('reward_pool_daily_ceiling_points');

  if v_ceiling > 0 and v_issued >= v_ceiling then
    update public.daily_issuance
       set ceiling_alerted_at = now()
     where day = v_today and ceiling_alerted_at is null;

    if found then
      insert into public.system_alerts (severity, code, message, context)
      values (
        'critical',
        'reward_pool_ceiling_exceeded',
        format('Daily points issuance (%s) has reached the configured ceiling (%s). Earning %s.',
               v_issued, v_ceiling,
               case when public.config_bool('reward_pool_ceiling_blocks')
                    then 'is now BLOCKED for the rest of the UTC day'
                    else 'was NOT blocked' end),
        jsonb_build_object(
          'day', v_today,
          'issued', v_issued,
          'ceiling', v_ceiling,
          'blocking', public.config_bool('reward_pool_ceiling_blocks')
        )
      );
    end if;
  end if;

  return v_entry;
end;
$$;

comment on function public.credit_points(uuid, bigint, public.ledger_entry_type, text, text, jsonb, boolean) is
  'Credits points and writes the ledger entry. When p_enforce_daily_cap is true it also enforces, in order: the platform reward-pool stop (if switched on), the tier ad count cap, the tier cooldown, and per_user_daily_points_cap. Ceilings refuse a credit whole rather than trimming it.';

revoke execute on function public.credit_points(uuid, bigint, public.ledger_entry_type, text, text, jsonb, boolean)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- submit_ad_answers — report the limit that actually stopped them
-- ---------------------------------------------------------------------------
--
-- Only the exception handler changes. It is restated whole for the same reason
-- as above: this is the function that decides whether somebody gets paid.

create or replace function public.submit_ad_answers(
  p_user_id  uuid,
  p_ad_id    uuid,
  p_answers  jsonb
)
returns public.ad_answer_result
language plpgsql
security definer
set search_path = ''
as $$
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
  v_all_correct boolean := true;
  v_qcount      int := 0;
  v_first_q     uuid;
  v_points      bigint;
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
    select q.id, q.answer_format, q.correct_answer
      from public.ad_questions q
     where q.ad_id = p_ad_id
     order by q.position
  loop
    if v_first_q is null then v_first_q := v_q.id; end if;

    v_submitted := p_answers ->> v_q.id::text;

    if v_submitted is null then
      v_all_correct := false;
    elsif v_q.answer_format = 'multiple_choice' then
      select exists (
        select 1 from public.ad_question_options o
         where o.question_id = v_q.id
           and o.id::text = v_submitted
           and o.is_correct
      ) into v_ok;
      v_all_correct := v_all_correct and v_ok;
    else
      v_all_correct := v_all_correct
        and lower(trim(v_submitted)) = lower(trim(v_q.correct_answer));
    end if;
  end loop;

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
            left(coalesce(p_answers::text, ''), 500), false, floor(v_elapsed)::int);

    if v_state.status = 'failed_locked' then
      return row('locked', 0, v_state.attempts_used, 0, null,
                 'Incorrect. No attempts remaining for this ad.')::public.ad_answer_result;
    end if;

    return row('incorrect', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'Incorrect. Watch the ad again to retry.')::public.ad_answer_result;
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

  v_points := greatest(floor(v_ad.points_reward * v_tier.reward_multiplier)::bigint, 1);

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
      'ad', p_ad_id::text,
      jsonb_build_object(
        'ad_title',          v_ad.title,
        'base_points',       v_ad.points_reward,
        'tier_slug',         v_tier.slug,
        'tier_multiplier',   v_tier.reward_multiplier,
        'watch_seconds',     floor(v_elapsed)::int,
        'attempt_number',    v_state.attempts_used + 1,
        'question_count',    v_qcount
      ),
      true
    );
  exception
    when sqlstate 'P0001' or sqlstate '23514' then
      -- Order is load-bearing. 'Daily points cap of ...' must be recognised
      -- before the plain ad cap, and both before the generic fallback; the
      -- user is told which limit they actually hit.
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
         completed_at       = now(),
         watch_completed_at = now(),
         watch_started_at   = null,
         updated_at         = now()
   where user_id = p_user_id and ad_id = p_ad_id
  returning * into v_state;

  insert into public.ad_attempts (user_id, ad_id, question_id, attempt_number,
                                  submitted_answer, is_correct, watch_seconds)
  values (p_user_id, p_ad_id, v_first_q, v_state.attempts_used,
          left(coalesce(p_answers::text, ''), 500), true, floor(v_elapsed)::int);

  select balance into v_balance from public.user_balances where user_id = p_user_id;

  return row('correct', v_points, v_state.attempts_used, 0, v_balance,
             format('%s points added.', v_points))::public.ad_answer_result;
end;
$$;

comment on function public.submit_ad_answers(uuid, uuid, jsonb) is
  'Grades an ad''s questions and credits or locks, in one transaction. All questions must be correct. An ad with no questions is credited on watch time alone. Refusals are reported distinctly — ad cap, cooldown, per-user points cap, or blocked — and none of them consume an attempt.';

revoke execute on function public.submit_ad_answers(uuid, uuid, jsonb)
  from public, anon, authenticated;
