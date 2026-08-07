-- ---------------------------------------------------------------------------
-- A checkpoint has to be passed before the course moves on.
--
-- Operator, 2026-08-07: "you cant skip a checkpoint question of a video, i was
-- able to skip" and "a quiz can never be skipped until correctly answered and
-- grade passed mark are attain."
--
-- Checkpoints were decorative. `quizzes.at_seconds` says where in a video a
-- checkpoint belongs and nothing read it; the quiz card simply sat under the
-- player, and Next moved on whether or not it had been touched. Since the
-- certificate now needs an average score, a course anybody can click past is
-- also a certificate anybody can collect.
--
-- ── THE SERVER HAS TO SAY WHAT IS PASSED ──
--
-- The client could not enforce this even if it wanted to: `lesson_for_learner`
-- returned each quiz's questions and never said whether this person had
-- already passed it, and `course_curriculum` returned `quiz_count` without
-- saying anything about attempts. Both now carry the answer, computed from
-- `quiz_attempts` against each quiz's own `pass_percent`.
--
-- ⚠️ The answer key still never leaves the database. This adds one boolean per
-- quiz, not the marking.
-- ---------------------------------------------------------------------------

/**
 * Has this person passed this quiz?
 *
 * Their BEST attempt, not their last. Retrying after a pass is allowed to
 * lower the number on screen; it must not take the pass away, or a curious
 * second attempt would re-lock a lesson somebody had already earned.
 */
create or replace function public.quiz_is_passed(p_user_id uuid, p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    max(qa.score_percent) >= (select z.pass_percent from public.quizzes z where z.id = p_quiz_id),
    false
  )
    from public.quiz_attempts qa
   where qa.quiz_id = p_quiz_id
     and qa.user_id = p_user_id;
$$;

revoke execute on function public.quiz_is_passed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.quiz_is_passed(uuid, uuid) to service_role;

/** Every checkpoint on a lesson passed? True when the lesson has none. */
create or replace function public.lesson_checkpoints_passed(p_user_id uuid, p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.quizzes z
     where z.lesson_id = p_lesson_id
       and not public.quiz_is_passed(p_user_id, z.id)
  );
$$;

revoke execute on function public.lesson_checkpoints_passed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lesson_checkpoints_passed(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The curriculum says which rows are behind an unpassed checkpoint.
--
-- ⚠️ DROPPED FIRST: the RETURNS TABLE signature changes, and `create or
-- replace` refuses that. The grants go with the drop and are restated.
-- ---------------------------------------------------------------------------

drop function if exists public.course_curriculum(uuid, uuid);

create or replace function public.course_curriculum(
  p_product_id uuid,
  p_user_id    uuid default null
)
returns table (
  section_id uuid, section_title text, section_position integer,
  lesson_id uuid, lesson_title text, lesson_position integer,
  kind text, duration_seconds integer, word_count integer,
  resource_count integer, quiz_count integer, is_preview boolean,
  completed boolean, seconds_watched integer, watched_percent integer,
  checkpoints_passed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.position,
         l.id, l.title, l.position,
         l.kind::text,
         l.duration_seconds,
         coalesce(array_length(regexp_split_to_array(btrim(coalesce(l.body, '')), '\s+'), 1), 0),
         (select count(*)::int from public.lesson_resources r where r.lesson_id = l.id),
         (select count(*)::int from public.quizzes q where q.lesson_id = l.id),
         l.is_preview,
         coalesce(lp.completed_at is not null, false),
         coalesce(lp.seconds_watched, 0),
         coalesce(lp.watched_percent, 0),
         public.lesson_checkpoints_passed(p_user_id, l.id)
    from public.course_sections s
    join public.lessons l on l.section_id = s.id
    left join public.lesson_progress lp
           on lp.lesson_id = l.id and lp.user_id = p_user_id
   where s.product_id = p_product_id
   order by s.position, l.position;
$$;

revoke execute on function public.course_curriculum(uuid, uuid) from public, anon, authenticated;
grant execute on function public.course_curriculum(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- And each quiz on the open lesson says whether it is already passed.
-- ---------------------------------------------------------------------------

create or replace function public.lesson_quiz_states(p_user_id uuid, p_lesson_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(z.id::text, public.quiz_is_passed(p_user_id, z.id)),
    '{}'::jsonb
  )
    from public.quizzes z
   where z.lesson_id = p_lesson_id;
$$;

revoke execute on function public.lesson_quiz_states(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lesson_quiz_states(uuid, uuid) to service_role;
