-- ============================================================================
-- Migration 191 — a survey answer is written down, one row per question
--
-- Operator, 2026-08-12: *"the response of surveys are not recorded. i want
-- that in CSV report where at anytime i can download them and see responses
-- so far."*
--
-- Correct, and the shape of the gap is worse than "missing". The grading loop
-- in `submit_ad_answers` reads every visible question, decides whether each
-- one is right, and then throws all of it away: ONE `ad_attempts` row is
-- written per submission, pinned to the FIRST question, with the entire
-- answers payload dumped into `submitted_answer` as text and a single
-- `is_correct` for the whole lot.
--
-- So for a three-question survey you could not say which option was chosen
-- for question two, and an ungraded question — an opinion, which is the whole
-- point of a survey — was never evaluated or stored at all. There was nothing
-- to report on.
--
-- ── A SEPARATE TABLE, NOT A WIDER `ad_attempts` ──
--
-- `ad_attempts` is about GRADING and fraud: `repeated_ad_failures` reads it,
-- and its `attempt_number` exists to catch somebody brute-forcing a quiz.
-- Answers are a different thing with a different lifetime — they are the data
-- the advertiser paid for — and mixing them would mean every fraud query
-- filtering out survey rows forever.
--
-- ── WHAT IS SNAPSHOT, AND WHY ──
--
-- The question text and the chosen option's label are COPIED onto the row.
-- The operator edits questions; an option can be deleted. A report that joins
-- live text would quietly rewrite history, so what is stored is what the
-- person actually saw and chose. The ids are kept beside them for anybody who
-- wants to group by question rather than by wording.
--
-- `is_correct` is NULL rather than false for an ungraded question. There is no
-- right answer to "how did you hear about us", and false would read as wrong.
-- ============================================================================

create table if not exists public.ad_responses (
  id             bigint generated always as identity primary key,
  ad_id          uuid not null references public.ads(id) on delete cascade,
  question_id    uuid references public.ad_questions(id) on delete set null,
  user_id        uuid not null references auth.users(id) on delete cascade,

  /* Which completion this belongs to. Ads repeat, so the same person answers
     the same survey more than once, and a report that cannot separate the
     occasions cannot count anything. Matches the ledger's occasion. */
  occasion       int not null default 1,
  attempt_number int not null default 1,

  question_position int,
  question_text     text not null,
  answer_format     text not null,
  is_graded         boolean not null default false,

  option_id      uuid references public.ad_question_options(id) on delete set null,
  /* The label as it read when they chose it, and the raw value they submitted.
     For a text answer the two are the same. */
  answer_label   text,
  answer_text    text,

  /* NULL when the question has no right answer, which is every real survey
     question. */
  is_correct     boolean,

  watch_seconds  int,
  answered_at    timestamptz not null default now()
);

create index if not exists ad_responses_ad_idx on public.ad_responses (ad_id, answered_at desc);
create index if not exists ad_responses_user_idx on public.ad_responses (user_id, answered_at desc);
create index if not exists ad_responses_question_idx on public.ad_responses (question_id);

alter table public.ad_responses enable row level security;

/* Answers are read by admins only. A respondent has no screen that shows them
   their own, and the table carries what other people answered. */
drop policy if exists ad_responses_admin_read on public.ad_responses;
create policy ad_responses_admin_read on public.ad_responses
  for select using (public.is_admin());

comment on table public.ad_responses is
  'One row per question answered, snapshotting the wording shown and the option chosen. Written by submit_ad_answers; read by admin_ad_responses for the CSV report.';


-- ---------------------------------------------------------------------------
-- The grading loop stops throwing its work away
-- ---------------------------------------------------------------------------
--
-- ⚠️ RESTATED FROM THE LIVE DEFINITION. Three changes: the loop selects the
-- wording and position it already had access to, every branch now records a
-- per-question result instead of only folding it into `v_all_correct`, and
-- each answer is inserted as it is read.

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

  v_points := public.ad_reward_points(p_user_id, v_ad.points_reward, coalesce(v_done, 0));

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
        'base_points',       v_ad.points_reward,
        'tier_slug',         v_tier.slug,
        'tier_multiplier',   v_tier.reward_multiplier,
        /* What THIS ad was paid at, which on a stacked account is not the
           tier's headline rate. Derived rather than re-queried so the number
           in the ledger cannot disagree with the number credited. */
        'ad_multiplier',     round(v_points::numeric / greatest(v_ad.points_reward, 1), 3),
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
-- The report
-- ---------------------------------------------------------------------------
--
-- Everything an operator or an advertiser could reasonably ask of a survey,
-- in one flat row per answer so a spreadsheet can pivot it without help:
--
--   WHEN   answered_at, and which occasion and attempt it belongs to, because
--          ads repeat and the same person answers more than once.
--   WHAT   the ad, its format, the question as it was WORDED AT THE TIME, its
--          position, and whether it was graded at all.
--   ANSWER the option label they chose (or their typed text), the option id
--          for grouping, and correct/incorrect — blank on an ungraded
--          question, because an opinion is neither.
--   WHO    the respondent's id and name, the plan they were on, and how long
--          they watched before answering. The plan is read NOW rather than
--          snapshot: a survey is usually read within days, and storing it per
--          answer would freeze a fact that belongs to the account.
--   PAID   what the completion paid, joined from the ledger by the same
--          occasion reference the credit used, so nobody has to reconcile two
--          exports by hand.
--
-- PHONE IS IN, EMAIL IS NOT (operator, 2026-08-12: "phone number only"). A
-- phone number is how this operator reaches somebody — it is the identifier
-- the whole product is built around — and the Team screen already shows one in
-- full by their explicit decision. Email is left out because it adds nothing
-- the phone does not already give and doubles what leaks if an export is
-- forwarded.
--
-- ⚠️ SO THIS FILE IDENTIFIES PEOPLE. It is a survey export with a name and a
-- reachable number on every row; treat it as personal data, and think before
-- forwarding it to an advertiser who only asked which option won.

create or replace function public.admin_ad_responses(
  p_admin_id uuid,
  p_ad_id    uuid default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  answered_at       timestamptz,
  ad_title          text,
  ad_format         text,
  ad_id             uuid,
  question_position int,
  question_text     text,
  answer_format     text,
  graded            boolean,
  answer            text,
  option_id         uuid,
  correct           boolean,
  occasion          int,
  attempt_number    int,
  watch_seconds     int,
  respondent        text,
  phone             text,
  user_id           uuid,
  plan              text,
  points_awarded    bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  /* Super admin only, the same gate every money and people screen uses. A
     survey export names respondents. */
  perform public.assert_admin(p_admin_id);

  return query
  select
    r.answered_at,
    a.title,
    a.format::text,
    r.ad_id,
    r.question_position,
    r.question_text,
    r.answer_format,
    r.is_graded,
    coalesce(r.answer_label, r.answer_text),
    r.option_id,
    r.is_correct,
    r.occasion,
    r.attempt_number,
    r.watch_seconds,
    coalesce(p.full_name, '(no name)'),
    p.phone,
    r.user_id,
    coalesce((public.resolve_user_tier(r.user_id)).name, '-'),
    /* What that completion paid. The reference carries the occasion, which is
       how a repeat is told from the first watch — see `ad_occasion_ref`. */
    (select l.amount
       from public.points_ledger l
      where l.user_id = r.user_id
        and l.reference_type = 'ad'
        and l.reference_id = public.ad_occasion_ref(r.ad_id, r.occasion)
      limit 1)
  from public.ad_responses r
  join public.ads a on a.id = r.ad_id
  left join public.profiles p on p.id = r.user_id
  where (p_ad_id is null or r.ad_id = p_ad_id)
    and (p_from  is null or r.answered_at >= p_from)
    and (p_to    is null or r.answered_at <  p_to)
  order by r.answered_at desc, r.question_position;
end;
$$;

revoke execute on function public.admin_ad_responses(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_ad_responses(uuid, uuid, timestamptz, timestamptz)
  to service_role;
