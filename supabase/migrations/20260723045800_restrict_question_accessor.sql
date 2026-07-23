-- ============================================================================
-- Migration 010 — Restrict the question accessor
--
-- The security advisor flagged get_ad_question_for_user() as a SECURITY
-- DEFINER function reachable by any signed-in user. It does not leak answers —
-- is_correct and correct_answer are absent from its return type, and that was
-- verified against the live API — but two things about it were wrong anyway.
--
-- 1. It served questions for ads in ANY status. A user could walk the function
--    over draft and paused ads and read campaign copy the operator has not
--    published, or re-read the question for an ad they have already failed and
--    are locked out of (§6.2).
--
-- 2. The client has no reason to call it. §2.4 makes the server the source of
--    truth: the earning flow will fetch the question server-side, hand the
--    browser a question with no key attached, and check the submitted answer
--    against the database. A client-callable accessor is surface with no
--    corresponding need.
--
-- So EXECUTE is revoked from `authenticated` as well, leaving service_role.
-- SECURITY DEFINER is retained deliberately: the function stays the single
-- safe way for server code to read a question, and its return type makes
-- leaking the answer impossible even if a future call site is careless with a
-- `select *`.
-- ============================================================================

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
  join public.ads a on a.id = q.ad_id
  left join public.ad_question_options o on o.question_id = q.id
  where q.ad_id = p_ad_id
    and q.position = p_position
    -- Only a live ad has a question worth asking. Draft, paused, exhausted and
    -- archived ads return nothing.
    and a.status = 'active'
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at   is null or a.ends_at   >  now())
  order by random();
$$;

comment on function public.get_ad_question_for_user(uuid, int) is
  'Server-side accessor. Returns a live ad''s question with options shuffled, and with is_correct/correct_answer structurally absent from the return type. service_role only.';

revoke execute on function public.get_ad_question_for_user(uuid, int)
  from public, anon, authenticated;
