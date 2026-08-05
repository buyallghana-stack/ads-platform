-- ============================================================================
-- Migration 120 — a lesson may be saved before its content exists
--
-- Migration 119 added `lessons_kind_has_content`: a video row had to carry a
-- `storage_path` and an article had to carry a `body`, enforced on every write.
--
-- THAT IS THE WRONG PLACE, and the same migration says so about everything
-- else. `lesson_is_ready()` exists precisely because some checks "span tables"
-- and are "asked at publish time so a half-authored lesson can be saved and
-- come back to" — and then the row constraint made exactly that impossible.
--
-- The authoring order is create-then-upload. An admin adds "Lesson 3: Reading
-- the dashboard", saves it, and uploads the video afterwards; a large upload
-- may not even finish in the same sitting. A constraint demanding the file up
-- front forces a placeholder path pointing at nothing, which is worse than no
-- check at all — it turns "unfinished" into something indistinguishable from
-- "finished and broken".
--
-- Caught by fourteen existing training tests, which create lessons the way the
-- admin will: a title and a position, with the file to follow.
--
-- So the check moves into `lesson_is_ready()`, which is what publishing asks
-- and which already reports what is missing as a sentence rather than as a
-- constraint name.
-- ============================================================================

alter table public.lessons
  drop constraint if exists lessons_kind_has_content;

comment on column public.lessons.storage_path is
  'Object key in the PRIVATE course-media bucket, for a video lesson. Null while the lesson is still being authored — `lesson_is_ready()` is what refuses to publish one that never got its file.';


create or replace function public.lesson_is_ready(p_lesson_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons;
  v_count  int;
begin
  select * into v_lesson from public.lessons where id = p_lesson_id;
  if not found then
    return 'Unknown lesson';
  end if;

  /* Moved here from a row constraint in migration 119. Same rule, asked at the
     moment it actually matters. */
  if v_lesson.kind = 'video' and v_lesson.storage_path is null then
    return 'This video has no file yet';
  end if;

  if v_lesson.kind = 'article'
     and (v_lesson.body is null or length(btrim(v_lesson.body)) = 0) then
    return 'This article has no text yet';
  end if;

  if v_lesson.kind = 'pdf' then
    select count(*) into v_count from public.lesson_resources where lesson_id = p_lesson_id;
    if v_count = 0 then
      return 'A reading lesson needs at least one resource';
    end if;
  end if;

  if v_lesson.kind = 'quiz' then
    select count(*) into v_count
      from public.quizzes q where q.lesson_id = p_lesson_id and q.at_seconds is null;
    if v_count = 0 then
      return 'A quiz lesson needs a quiz';
    end if;
  end if;

  select count(*) into v_count
    from public.quizzes q
    join public.quiz_questions qq on qq.quiz_id = q.id
   where q.lesson_id = p_lesson_id
     and not exists (
       select 1 from public.quiz_options o
        where o.question_id = qq.id and o.is_correct
     );
  if v_count > 0 then
    return v_count || ' question(s) have no correct answer';
  end if;

  select count(*) into v_count
    from public.quizzes q
    join public.quiz_questions qq on qq.quiz_id = q.id
   where q.lesson_id = p_lesson_id
     and (select count(*) from public.quiz_options o where o.question_id = qq.id) < 2;
  if v_count > 0 then
    return v_count || ' question(s) have fewer than two options';
  end if;

  return null;   -- ready
end;
$$;

revoke execute on function public.lesson_is_ready(uuid) from public, anon, authenticated;
grant execute on function public.lesson_is_ready(uuid) to service_role;


/*
  AND THE SAME QUESTION FOR A WHOLE PRODUCT, since publishing happens at that
  level rather than lesson by lesson. Returns one row per unready lesson, so
  the admin screen can list what is left rather than reporting the first
  problem and hiding the other nine.
*/
create or replace function public.product_publish_blockers(p_product_id uuid)
returns table (lesson_id uuid, lesson_title text, section_title text, problem text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.title, s.title, public.lesson_is_ready(l.id)
    from public.lessons l
    join public.course_sections s on s.id = l.section_id
   where s.product_id = p_product_id
     and public.lesson_is_ready(l.id) is not null
   order by s.position, l.position;
$$;

comment on function public.product_publish_blockers(uuid) is
  'Every lesson that is not ready, with a sentence saying why. One row each, so the admin sees the whole list rather than the first problem.';

revoke execute on function public.product_publish_blockers(uuid) from public, anon, authenticated;
grant execute on function public.product_publish_blockers(uuid) to service_role;
