-- ---------------------------------------------------------------------------
-- Every resource in a course, in one read.
--
-- The player grows a Resources tab, which is the honest answer to the
-- reference's "Downloads" tab: the reference lets you pull the files onto the
-- phone, and we do not, because a downloaded copy of a paid course outlives the
-- entitlement that paid for it. What a learner actually wanted from that tab is
-- "where was that worksheet" — a list of everything attached to the course,
-- with the lesson each one belongs to, openable in the app.
--
-- `lesson_for_learner` already returns resources, but only for the ONE lesson
-- it was asked about. Answering "everything in this course" by calling it once
-- per lesson would be thirty round trips to build one list.
--
-- ── THE ENTITLEMENT PREDICATE IS THE SAME ONE ──
--
-- `is_preview or has_entitlement(...)`, exactly as `lesson_for_learner` applies
-- it. A second way of deciding who may see paid material is a second way of
-- getting it wrong, and the two would drift the first time either changed.
-- Resource TITLES are as much of the product as the lesson titles are, so an
-- unentitled viewer gets the preview lessons' resources and nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.course_resources(
  p_product_id uuid,
  p_user_id    uuid default null
)
returns table (
  resource_id   uuid,
  title         text,
  byte_size     bigint,
  lesson_id     uuid,
  lesson_title  text,
  section_title text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.title, r.byte_size, l.id, l.title, s.title
    from public.lesson_resources r
    join public.lessons l on l.id = r.lesson_id
    join public.course_sections s on s.id = l.section_id
   where s.product_id = p_product_id
     and (l.is_preview or public.has_entitlement(p_user_id, p_product_id))
   order by s.position, l.position, r.position;
$$;

/* ⚠️ `create function` GRANTS EXECUTE TO PUBLIC. Without this revoke the anon
   key could list the attachments of every paid course by product id. */
revoke execute on function public.course_resources(uuid, uuid) from public, anon, authenticated;
grant execute on function public.course_resources(uuid, uuid) to service_role;
