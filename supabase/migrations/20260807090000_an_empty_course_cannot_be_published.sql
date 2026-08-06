-- ============================================================================
-- Migration 133 — an empty course must not be publishable
--
-- `product_publish_blockers` walks the LESSON list looking for problems. A
-- course with no lessons has nothing to walk, so it returns zero rows, so
-- `admin_set_product_status` sees zero blockers and publishes it.
--
-- Both training courses are in exactly that state right now: a title, a price,
-- and no content whatsoever. Publishing either one today would put a GHS 400
-- product on sale that opens an empty player.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS WORSE THAN AN EMPTY PAGE
--
-- For a TRAINING product it is not merely disappointing, it is a dead end that
-- takes money:
--
--   `training_completion_percent` returns 0 when a course has no lessons —
--   there is nothing to divide by. Activation needs the completion percentage
--   to reach `activation_threshold_percent`, which is 50. Zero never reaches
--   fifty.
--
-- So somebody pays GHS 400 for the Professional course, and the affiliate
-- account they bought it for can NEVER activate, because there is no lesson
-- they could complete to move the number. They have bought a right to promote
-- that is structurally unreachable, and no amount of effort on their part
-- fixes it.
--
-- ---------------------------------------------------------------------------
-- TWO NEW BLOCKERS
--
--   1. the course has no lessons at all
--   2. a section has no lessons in it
--
-- The second is cosmetic rather than financial — an empty section renders as a
-- header with nothing under it, which reads as a loading failure — but it is
-- the same shape of mistake and costs nothing to catch here.
--
-- Course-level blockers carry a null `lesson_id`, which the return type already
-- permits. Callers render `problem` and do not depend on the id being present.
-- ============================================================================

create or replace function public.product_publish_blockers(p_product_id uuid)
returns table(lesson_id uuid, lesson_title text, section_title text, problem text)
language sql
stable
security definer
set search_path = ''
as $$
  -- 1. Nothing in the course at all. Ordered first by the union below so that
  --    `min(problem)` in admin_set_product_status surfaces something useful:
  --    "This course has no lessons" explains the refusal on its own.
  select null::uuid, null::text, null::text,
         'This course has no lessons yet'::text
    where not exists (
      select 1
        from public.lessons l
        join public.course_sections s on s.id = l.section_id
       where s.product_id = p_product_id
    )

  union all

  -- 2. A section that would render as a header with nothing beneath it.
  --
  --    SUPPRESSED WHILE THE WHOLE COURSE IS EMPTY. A brand new course has a
  --    section and no lessons, so without this guard it reports "this course
  --    has no lessons" AND "section X has no lessons" — two complaints about
  --    one problem, and fixing the section is not the point. Adding lessons
  --    is, and blocker 1 already says so. Once anything exists in the course,
  --    a still-empty section becomes a real and separate mistake.
  select null::uuid, null::text, s.title,
         ('Section "' || s.title || '" has no lessons')::text
    from public.course_sections s
   where s.product_id = p_product_id
     and not exists (select 1 from public.lessons l where l.section_id = s.id)
     and exists (
       select 1
         from public.lessons l2
         join public.course_sections s2 on s2.id = l2.section_id
        where s2.product_id = p_product_id
     )

  union all

  -- 3. The original per-lesson checks, unchanged.
  select l.id, l.title, s.title, public.lesson_is_ready(l.id)
    from public.lessons l
    join public.course_sections s on s.id = l.section_id
   where s.product_id = p_product_id
     and public.lesson_is_ready(l.id) is not null
   order by 3 nulls first, 4;
$$;

-- ⚠️ `create or replace` re-grants EXECUTE to PUBLIC. This one is read-only and
-- admin-facing, but the catalogue it describes is not public while in draft, so
-- it is locked down like every other Phase 2 function.
revoke execute on function public.product_publish_blockers(uuid) from public, anon, authenticated;
grant  execute on function public.product_publish_blockers(uuid) to service_role;
