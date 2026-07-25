-- ============================================================================
-- Migration 043 — a survey is not a quiz
--
-- Operator, after answering the seeded surveys (2026-07-25):
--
--   "a survey is not a quiz, and a user is at liberty to think whatever he
--    wants and then answer"
--
-- They are right, and the model was wrong. Every question carried a "correct"
-- answer and submit_ad_answers demanded all of them, so somebody answering
-- "Which do you use most often to pay? — Cash" was told "Not quite" and had an
-- attempt taken off them. That is not a survey; it is a quiz about the
-- advertiser's assumptions, and it would poison the research data too, because
-- the only respondents who get paid are the ones who guessed the answer the
-- admin happened to tick.
--
-- THE RULE, from here on
-- ----------------------
-- A question is GRADED only if a correct answer actually exists for it:
--
--   multiple choice  some option is flagged is_correct
--   short text       correct_answer is not null
--
-- Anything else is an OPINION question: any answer the user gives is accepted,
-- and it is recorded. Nothing new to configure and nothing to migrate — an
-- admin makes an opinion question by not ticking an answer, which is what
-- "there is no right answer" means.
--
-- The attention question on a video is untouched: it has a correct answer, so
-- it is still graded, and it is still the thing that stops a script earning.
-- A survey may still carry a graded attention-check ("tick Blue so we know you
-- are reading") — a standard market-research device — because that is simply a
-- question the admin DID tick an answer for.
--
-- Answering is still required. An opinion question accepts any answer but not
-- no answer, so a survey cannot be cleared by submitting an empty form.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Short text may be an opinion question
-- ---------------------------------------------------------------------------
--
-- The old constraint FORCED every short-text question to carry a correct
-- answer, which made "Which town do you travel in most?" impossible to express
-- honestly. Null now means opinion; a non-null value must still be meaningful
-- rather than blank.

alter table public.ad_questions
  drop constraint if exists ad_questions_shortext_has_answer;

alter table public.ad_questions
  add constraint ad_questions_shortext_has_answer check (
    (answer_format = 'short_text'
       and (correct_answer is null or length(trim(correct_answer)) > 0))
    or
    (answer_format = 'multiple_choice' and correct_answer is null)
  );

comment on column public.ad_questions.correct_answer is
  'Short-text answer key, compared case-insensitively and trimmed. NULL means this is an opinion question: any answer is accepted. Admin-only — never sent to a client.';

comment on column public.ad_question_options.is_correct is
  'Marks the answer key for a graded question. A multiple-choice question with NO option flagged is an opinion question: any choice is accepted. Admin-only.';


-- ---------------------------------------------------------------------------
-- 2. get_ad_feed reports whether an ad grades anything
-- ---------------------------------------------------------------------------
--
-- So the player can tell a respondent up front that there are no right or
-- wrong answers, which is the whole point of the operator's correction. It is
-- a single boolean for the WHOLE ad, deliberately: saying WHICH question is
-- graded would hand a cheat the one question that matters on a survey that
-- carries an attention check.

drop function if exists public.get_ad_feed(uuid, public.ad_format, int);

create function public.get_ad_feed(
  p_user_id uuid,
  p_format  public.ad_format default null,
  p_limit   int default 40
)
returns table (
  id                 uuid,
  title              text,
  description        text,
  advertiser_name    text,
  format             public.ad_format,
  points_reward      bigint,
  points_award       bigint,
  video_source       public.video_source,
  storage_path       text,
  youtube_video_id   text,
  thumbnail_path     text,
  duration_seconds   int,
  min_watch_seconds  int,
  question_count     int,
  graded_count       int,
  attempts_used      int,
  attempts_remaining int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller    uuid := (select auth.uid());
  v_tier      public.tiers;
  v_retry_cap int := public.config_int('ad_retry_cap')::int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    a.points_reward,
    greatest(floor(a.points_reward * v_tier.reward_multiplier)::bigint, 1),
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
    coalesce(s.attempts_used, 0),
    greatest(v_retry_cap - coalesce(s.attempts_used, 0), 0)
  from public.ads a
  left join public.user_ad_state s
    on s.user_id = p_user_id and s.ad_id = a.id
  where a.status = 'active'
    and (p_format is null or a.format = p_format)
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at   is null or a.ends_at   >  now())
    and (a.max_completions is null or a.completions_count < a.max_completions)
    and coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
  order by
    -ln(
      (abs(hashtextextended(
             p_user_id::text || a.id::text || public.utc_today()::text, 0
           )) % 1000000 + 1)::numeric / 1000001.0
    ) / a.weight
  limit greatest(p_limit, 1);
end;
$$;

comment on function public.get_ad_feed(uuid, public.ad_format, int) is
  'The ads tab in one call. graded_count is how many of the ad''s questions have a right answer; zero means every question is opinion and nothing the user says can be wrong.';

revoke execute on function public.get_ad_feed(uuid, public.ad_format, int)
  from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, int)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. submit_ad_answers grades only what has an answer key
-- ---------------------------------------------------------------------------

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
  v_graded      boolean;
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
    select q.id, q.answer_format, q.correct_answer,
           -- A question is graded only if an answer key exists for it. No key
           -- means the admin is asking an opinion, and an opinion cannot be
           -- wrong.
           (q.correct_answer is not null
            or exists (select 1 from public.ad_question_options o
                        where o.question_id = q.id and o.is_correct)) as is_graded
      from public.ad_questions q
     where q.ad_id = p_ad_id
     order by q.position
  loop
    if v_first_q is null then v_first_q := v_q.id; end if;

    v_submitted := p_answers ->> v_q.id::text;
    v_graded    := v_q.is_graded;

    if v_submitted is null or length(trim(v_submitted)) = 0 then
      -- Answering is always required, opinion or not; an empty form must not
      -- clear a survey.
      v_all_correct := false;
    elsif not v_graded then
      null;  -- any answer accepted, and it is recorded below
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
    when unique_violation then
      update public.user_ad_state
         set status           = 'completed',
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
         completed_at       = now(),
         watch_completed_at = now(),
         watch_started_at   = null,
         updated_at         = now()
   where user_id = p_user_id and ad_id = p_ad_id
  returning * into v_state;

  -- 4000, not 500. On a survey these ARE the advertiser's answers, not just
  -- fraud evidence, and a five-question run of uuid->uuid pairs ran past the
  -- old limit and lost the tail. Proper per-response reporting wants its own
  -- table when the admin dashboard is built.
  insert into public.ad_attempts (user_id, ad_id, question_id, attempt_number,
                                  submitted_answer, is_correct, watch_seconds)
  values (p_user_id, p_ad_id, v_first_q, v_state.attempts_used,
          left(coalesce(p_answers::text, ''), 4000), true, floor(v_elapsed)::int);

  select balance into v_balance from public.user_balances where user_id = p_user_id;

  return row('correct', v_points, v_state.attempts_used, 0, v_balance,
             format('%s points added.', v_points))::public.ad_answer_result;
end;
$$;

comment on function public.submit_ad_answers(uuid, uuid, jsonb) is
  'Grades an ad''s questions and credits or locks, in one transaction. Only questions with an answer key are graded — an opinion question accepts any answer but still requires one. An ad with no questions is credited on watch time alone.';

revoke execute on function public.submit_ad_answers(uuid, uuid, jsonb)
  from public, anon, authenticated;
