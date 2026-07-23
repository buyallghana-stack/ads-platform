-- ============================================================================
-- Migration 011 — The earning loop
--
-- Where the ad model meets the ledger (§6.2, §6.3). Two functions:
--
--   register_ad_view()   the server records that an ad was served, and when.
--   submit_ad_answers()  the server checks the answer and credits or locks.
--
-- Why the watch clock lives on the server
-- ---------------------------------------
-- The obvious design has the player report how long it watched. That number is
-- client-supplied, so a script sends the minimum and skips the video entirely
-- (§2.4: never trust the client). Instead register_ad_view() stamps
-- watch_started_at server-side, and submit_ad_answers() requires real elapsed
-- wall-clock time. The client cannot shorten it by lying.
--
-- This does not prove attention — someone can open an ad and wait. That is
-- exactly why the brief pairs it with the attention question (§3), and why
-- YouTube's weak completion tracking was accepted. Elapsed time stops the
-- cheapest attack; the question stops the next one.
--
-- Re-watch on retry (§6.2)
-- ------------------------
-- A wrong answer clears watch_started_at. With no start stamp the next
-- submission is refused, so the user must call register_ad_view() again — the
-- clock restarts and the video plays from the top. Enforced by state, not by
-- asking the UI to behave.
--
-- Everything happens in one transaction. If crediting fails for any reason —
-- daily cap, kill switch, disabled account, an ad exhausting underneath the
-- user — the attempt is not consumed and the ad stays available. The user is
-- never charged an attempt for a failure that was not theirs.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- watch_started_at
-- ---------------------------------------------------------------------------

alter table public.user_ad_state
  add column watch_started_at timestamptz;

comment on column public.user_ad_state.watch_started_at is
  'Server-stamped when the ad was served. Cleared on a wrong answer, which is what forces a re-watch before the next attempt (§6.2).';


-- ---------------------------------------------------------------------------
-- Outcome type
-- ---------------------------------------------------------------------------
--
-- A composite result rather than an exception for expected outcomes. A wrong
-- answer is normal operation and the caller needs the surrounding state —
-- attempts left, new balance — to render anything useful. Exceptions stay for
-- genuine faults.

create type public.ad_answer_outcome as enum (
  'correct',           -- points credited
  'incorrect',         -- attempt consumed, re-watch required
  'locked',            -- retry cap spent; ad closed for this user
  'already_completed', -- nothing to do
  'not_eligible',      -- ad paused, exhausted, out of schedule or unknown
  'not_watched',       -- no live watch stamp: never started, or must re-watch
  'too_fast',          -- answered before min_watch_seconds of real time
  'daily_cap_reached', -- tier cap hit; no attempt consumed
  'earning_blocked'    -- kill switch or disabled account; no attempt consumed
);

create type public.ad_answer_result as (
  outcome             public.ad_answer_outcome,
  points_awarded      bigint,
  attempts_used       int,
  attempts_remaining  int,
  new_balance         bigint,
  message             text
);


-- ---------------------------------------------------------------------------
-- register_ad_view — start the server-side watch clock
-- ---------------------------------------------------------------------------

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
begin
  select * into v_ad
    from public.ads a
   where a.id = p_ad_id
     and a.status = 'active'
     and (a.starts_at is null or a.starts_at <= now())
     and (a.ends_at   is null or a.ends_at   >  now())
     and (a.max_completions is null or a.completions_count < a.max_completions);

  if not found then
    raise exception 'Ad is not available' using errcode = 'check_violation';
  end if;

  -- Re-serving an ad the user has finished with must not silently reopen it.
  select * into v_state
    from public.user_ad_state s
   where s.user_id = p_user_id and s.ad_id = p_ad_id;

  if found and v_state.status in ('completed', 'failed_locked') then
    raise exception 'Ad is closed for this user (%)', v_state.status
      using errcode = 'check_violation';
  end if;

  insert into public.user_ad_state (user_id, ad_id, status, watch_started_at)
  values (p_user_id, p_ad_id, 'in_progress', now())
  on conflict (user_id, ad_id) do update
    set watch_started_at   = now(),
        watch_completed_at = null,
        updated_at         = now();

  return now();
end;
$$;

comment on function public.register_ad_view(uuid, uuid) is
  'Starts the server-side watch clock. Must be called before submit_ad_answers, and again after any wrong answer.';

revoke execute on function public.register_ad_view(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- submit_ad_answers
-- ---------------------------------------------------------------------------
--
-- p_answers maps question id to submitted answer:
--   { "<question uuid>": "<option uuid or free text>" }
--
-- One shape for both formats. A video ad has a single entry; a survey has one
-- per question and every one must be correct (§6.2 treats a survey as a longer
-- attention question). Partial credit is deliberately not offered — it would
-- let a user brute-force a survey one question at a time.

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
  v_result      public.ad_answer_result;
begin
  v_retry_cap := public.config_int('ad_retry_cap')::int;

  -- Lock the user's row for this ad. Two simultaneous submissions for the same
  -- ad must not both consume an attempt or both credit.
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

  -- Re-watch gate: a wrong answer cleared this stamp.
  if v_state.watch_started_at is null then
    return row('not_watched', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'Watch the ad again before answering.')::public.ad_answer_result;
  end if;

  -- The ad must still be live. It may have been paused or exhausted while the
  -- user was watching.
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

  -- Server-side watch time. Client-reported duration is not consulted.
  v_min_watch := coalesce(v_ad.min_watch_seconds, 0);
  v_elapsed   := extract(epoch from (now() - v_state.watch_started_at));

  if v_elapsed < v_min_watch then
    return row('too_fast', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               format('Keep watching — %s more second(s) required.',
                      ceil(v_min_watch - v_elapsed)))::public.ad_answer_result;
  end if;

  -- Grade every question on the ad. All must be correct.
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
      -- The submitted value is an option id. Checked against the database, so
      -- the correct id never has to leave it.
      select exists (
        select 1 from public.ad_question_options o
         where o.question_id = v_q.id
           and o.id::text = v_submitted
           and o.is_correct
      ) into v_ok;
      v_all_correct := v_all_correct and v_ok;
    else
      -- Short text: case-insensitive, whitespace-trimmed. An exact-match
      -- comparison would fail honest users over a capital letter.
      v_all_correct := v_all_correct
        and lower(trim(v_submitted)) = lower(trim(v_q.correct_answer));
    end if;
  end loop;

  if v_qcount = 0 then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad has no question configured.')::public.ad_answer_result;
  end if;

  -- ---------------------------------------------------------------------
  -- Wrong answer
  -- ---------------------------------------------------------------------
  if not v_all_correct then
    update public.user_ad_state
       set attempts_used    = attempts_used + 1,
           watch_started_at = null,   -- forces a re-watch (§6.2)
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

  -- ---------------------------------------------------------------------
  -- Correct answer
  -- ---------------------------------------------------------------------
  v_tier := public.resolve_user_tier(p_user_id);

  -- Tier multiplier applied to the admin's per-ad points (§6.2, §6.7).
  -- floor(), not round(): rounding down is predictable and never pays more
  -- than configured. Guaranteed at least one point so a fractional multiplier
  -- cannot silently zero a reward.
  v_points := greatest(floor(v_ad.points_reward * v_tier.reward_multiplier)::bigint, 1);

  -- Claim a completion slot before crediting. The WHERE guard is what stops
  -- two users simultaneously taking the last slot of a budget.
  update public.ads
     set completions_count = completions_count + 1
   where id = p_ad_id
     and (max_completions is null or completions_count < max_completions);

  if not found then
    return row('not_eligible', 0, v_state.attempts_used,
               greatest(v_retry_cap - v_state.attempts_used, 0), null,
               'This ad just reached its limit.')::public.ad_answer_result;
  end if;

  -- credit_points owns the daily cap, cooldown, kill switch and disabled-account
  -- checks. Catching its exception rolls back this subtransaction — including
  -- the completion slot above — so a capped user consumes no attempt and the
  -- ad remains available to them tomorrow.
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
        'attempt_number',    v_state.attempts_used + 1
      ),
      true  -- enforce the daily cap
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
     set status           = 'completed',
         attempts_used    = attempts_used + 1,
         completed_at     = now(),
         watch_completed_at = now(),
         watch_started_at = null,
         updated_at       = now()
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
  'Grades an ad''s questions and credits or locks, in one transaction. All questions must be correct. A failure that is not the user''s fault (cap, kill switch, ad exhausting) consumes no attempt.';

revoke execute on function public.submit_ad_answers(uuid, uuid, jsonb)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- get_user_earning_status — what the dashboard needs, in one call
-- ---------------------------------------------------------------------------
--
-- Bundled so the cap banner and balance do not cost three round trips on every
-- page. This is a read on the hot path (§8).

create or replace function public.get_user_earning_status(p_user_id uuid)
returns table (
  balance              bigint,
  tier_slug            text,
  tier_name            text,
  daily_ad_cap         int,
  ads_completed_today  int,
  ads_remaining_today  int,
  currency_value       numeric,
  earning_paused       boolean,
  account_disabled     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(b.balance, 0),
    t.slug,
    t.name,
    t.daily_ad_cap,
    coalesce(c.ads_completed, 0),
    greatest(t.daily_ad_cap - coalesce(c.ads_completed, 0), 0),
    round(coalesce(b.balance, 0)::numeric
          / nullif(public.config_int('points_per_currency_unit'), 0), 2),
    public.config_bool('earning_paused_globally'),
    (select p.disabled_at is not null from public.profiles p where p.id = p_user_id)
  from (select public.resolve_user_tier(p_user_id) as tier) r
  cross join lateral (select (r.tier).*) t
  left join public.user_balances b on b.user_id = p_user_id
  left join public.daily_earning_counters c
    on c.user_id = p_user_id and c.day = public.utc_today();
$$;

comment on function public.get_user_earning_status(uuid) is
  'Balance, tier, cap progress and live currency value in one round trip.';

revoke execute on function public.get_user_earning_status(uuid) from public, anon;
