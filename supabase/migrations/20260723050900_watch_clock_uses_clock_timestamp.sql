-- ============================================================================
-- Migration 012 — Measure watch time with clock_timestamp(), not now()
--
-- now() returns the transaction start time and is frozen for the duration of
-- that transaction. The watch guard compared now() at submission against a
-- watch_started_at also written by now(), so any caller that performed both
-- steps inside one transaction measured an elapsed time of exactly zero and
-- was refused with 'too_fast' no matter how long it actually waited.
--
-- Over HTTP each request is its own transaction, so the guard did work in the
-- intended flow. But correctness that depends on the caller never batching two
-- operations is not correctness — it is a coincidence that holds until someone
-- wraps the flow in a transaction, writes an integration test, or calls both
-- from a single stored procedure. It also made the behaviour untestable from
-- SQL, which is how it was found.
--
-- clock_timestamp() reads the actual clock every time it is called, so elapsed
-- watch time is real wall-clock time regardless of transaction boundaries.
--
-- Stored timestamps that are not part of this measurement keep using now(),
-- which is the right choice for "when did this transaction happen".
-- ============================================================================

create or replace function public.register_ad_view(
  p_user_id uuid,
  p_ad_id   uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ad    public.ads;
  v_state public.user_ad_state;
  v_now   timestamptz := clock_timestamp();
begin
  select * into v_ad
    from public.ads a
   where a.id = p_ad_id
     and a.status = 'active'
     and (a.starts_at is null or a.starts_at <= v_now)
     and (a.ends_at   is null or a.ends_at   >  v_now)
     and (a.max_completions is null or a.completions_count < a.max_completions);

  if not found then
    raise exception 'Ad is not available' using errcode = 'check_violation';
  end if;

  select * into v_state
    from public.user_ad_state s
   where s.user_id = p_user_id and s.ad_id = p_ad_id;

  if found and v_state.status in ('completed', 'failed_locked') then
    raise exception 'Ad is closed for this user (%)', v_state.status
      using errcode = 'check_violation';
  end if;

  insert into public.user_ad_state (user_id, ad_id, status, watch_started_at)
  values (p_user_id, p_ad_id, 'in_progress', v_now)
  on conflict (user_id, ad_id) do update
    set watch_started_at   = v_now,
        watch_completed_at = null,
        updated_at         = now();

  return v_now;
end;
$$;

comment on function public.register_ad_view(uuid, uuid) is
  'Starts the server-side watch clock using clock_timestamp(). Must be called before submit_ad_answers, and again after any wrong answer.';

revoke execute on function public.register_ad_view(uuid, uuid) from public, anon, authenticated;


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
  v_now         timestamptz := clock_timestamp();
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
     and (a.starts_at is null or a.starts_at <= v_now)
     and (a.ends_at   is null or a.ends_at   >  v_now)
     and (a.max_completions is null or a.completions_count < a.max_completions);

  if not found then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad is no longer available.')::public.ad_answer_result;
  end if;

  -- Real wall-clock elapsed time, independent of transaction boundaries.
  v_min_watch := coalesce(v_ad.min_watch_seconds, 0);
  v_elapsed   := extract(epoch from (v_now - v_state.watch_started_at));

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
    v_qcount := v_qcount + 1;
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

  if v_qcount = 0 then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad has no question configured.')::public.ad_answer_result;
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

  begin
    v_entry := public.credit_points(
      p_user_id, v_points,
      case v_ad.format when 'survey' then 'survey'::public.ledger_entry_type
                       else 'ad_view'::public.ledger_entry_type end,
      'ad', p_ad_id::text,
      jsonb_build_object(
        'ad_title',        v_ad.title,
        'base_points',     v_ad.points_reward,
        'tier_slug',       v_tier.slug,
        'tier_multiplier', v_tier.reward_multiplier,
        'watch_seconds',   floor(v_elapsed)::int,
        'attempt_number',  v_state.attempts_used + 1
      ),
      true
    );
  exception
    when sqlstate 'P0001' or sqlstate '23514' then
      if sqlerrm like '%Daily cap%' or sqlerrm like '%Cooldown%' then
        return row('daily_cap_reached', 0, v_state.attempts_used,
                   greatest(v_retry_cap - v_state.attempts_used, 0), null,
                   sqlerrm)::public.ad_answer_result;
      end if;
      return row('earning_blocked', 0, v_state.attempts_used,
                 greatest(v_retry_cap - v_state.attempts_used, 0), null,
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
             format('Correct. %s points added.', v_points))::public.ad_answer_result;
end;
$$;

comment on function public.submit_ad_answers(uuid, uuid, jsonb) is
  'Grades an ad''s questions and credits or locks, in one transaction. Watch time measured with clock_timestamp() so it is real elapsed time.';

revoke execute on function public.submit_ad_answers(uuid, uuid, jsonb)
  from public, anon, authenticated;
