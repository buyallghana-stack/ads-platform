-- ============================================================================
-- Migration 009 — Correct the volatility of the randomised serving functions
--
-- get_eligible_ads() and get_ad_question_for_user() were declared STABLE while
-- both call random(). That is wrong, and Postgres is entitled to act on it: a
-- STABLE function is guaranteed to return the same result for the same
-- arguments within a single statement, so the planner may evaluate it once and
-- reuse the answer.
--
-- Demonstrated on the live database before fixing. Ten calls inside one query
-- returned ONE distinct ad; the same ten calls as separate statements returned
-- a proper spread. It also produced a misleading test result — a weighting
-- check appeared to pass 200/200 when it was in fact one cached row repeated
-- 200 times.
--
-- Consequences had this shipped:
--   * Any query that fans get_eligible_ads() across several users — a lateral
--     join, a batch prefetch — would hand every one of them the same ad.
--   * Option shuffling (§6.2) would freeze within a statement, so a question
--     rendered alongside anything else could present a fixed option order.
--     Fixed order plus a fixed answer is a pattern worth learning, which is
--     precisely what shuffling exists to prevent.
--
-- VOLATILE is the correct declaration for anything built on random(). It also
-- stops the planner hoisting these out of a per-row context.
-- ============================================================================

create or replace function public.get_eligible_ads(
  p_user_id uuid,
  p_limit   int default 10
)
returns setof public.ads
language sql
volatile
set search_path = ''
as $$
  select a.*
  from public.ads a
  where a.status = 'active'
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at   is null or a.ends_at   >  now())
    and (a.max_completions is null or a.completions_count < a.max_completions)
    and not exists (
      select 1 from public.user_ad_state s
      where s.user_id = p_user_id
        and s.ad_id   = a.id
        and s.status in ('completed', 'failed_locked')
    )
  order by -ln(random()) / a.weight
  limit greatest(p_limit, 1);
$$;

comment on function public.get_eligible_ads(uuid, int) is
  'Ads this user may watch now, weighted-random. VOLATILE because it uses random() — declaring it STABLE lets the planner evaluate it once and serve every user the same ad.';

create or replace function public.get_ad_question_for_user(
  p_ad_id    uuid,
  p_position int default 0
)
returns table (
  question_id   uuid,
  question_text text,
  answer_format public.answer_format,
  option_id     uuid,
  option_text   text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select q.id, q.question_text, q.answer_format, o.id, o.option_text
  from public.ad_questions q
  left join public.ad_question_options o on o.question_id = q.id
  where q.ad_id = p_ad_id
    and q.position = p_position
  order by random();
$$;

comment on function public.get_ad_question_for_user(uuid, int) is
  'Question plus shuffled options, with is_correct and correct_answer structurally absent from the return type. VOLATILE so the shuffle is genuinely per-call.';

revoke execute on function public.get_ad_question_for_user(uuid, int) from public, anon;
