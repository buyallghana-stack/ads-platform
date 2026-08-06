-- ============================================================================
-- Migration 138 — `course_outline` ignored the product it was asked about
--
-- The function takes `p_product_id` and never mentions it again:
--
--     select s.id, s.title, s.position, l.id, l.title, ...
--       from public.course_sections s
--       join public.products p on p.id = s.product_id and p.status = 'published'
--       left join public.lessons l on l.section_id = s.id
--      order by s.position, l.position
--
-- No `where s.product_id = p_product_id`. It returned the curriculum of EVERY
-- published product, interleaved by position, for any id you passed it.
--
-- ---------------------------------------------------------------------------
-- WHY TWO TESTS COVERED THIS AND NEITHER CAUGHT IT
--
-- `content.test.ts` asserts both that a draft leaks nothing and that ordering
-- is preserved. Both passed for months — because until now there was no
-- PUBLISHED product with any lessons in it. The join found nothing, the
-- function returned zero rows, and:
--
--   "a draft returns 0 rows"           passed because everything returned 0
--   "order is First/A then Second/B"   passed because the test's own product
--                                      was the only published one in scope
--
-- The tests were correct. They were passing vacuously, and the emptiness of
-- the database was doing the work the WHERE clause should have been doing.
-- Seeding real published courses is what made them fail, which is the argument
-- for having real data in a shared test database rather than an empty one.
--
-- ---------------------------------------------------------------------------
-- WHAT IT WOULD HAVE LOOKED LIKE
--
-- A shop page for one course listing every other course's lessons, mixed
-- together in position order. Titles only, published products only — so not a
-- leak of paid CONTENT — but plainly broken, and it would have shipped the
-- moment two products existed.
--
-- `shop_product` (migration 137) was not affected: it does its own subquery
-- filtered on `s.product_id = v_product.id`.
-- ============================================================================

create or replace function public.course_outline(p_product_id uuid)
returns table (
  section_id uuid,
  section_title text,
  section_position integer,
  lesson_id uuid,
  lesson_title text,
  lesson_position integer,
  duration_seconds integer,
  is_preview boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.position,
         l.id, l.title, l.position, l.duration_seconds, l.is_preview
    from public.course_sections s
    join public.products p on p.id = s.product_id and p.status = 'published'
    left join public.lessons l on l.section_id = s.id
   where s.product_id = p_product_id      -- the line that was missing
   order by s.position, l.position;
$$;

revoke execute on function public.course_outline(uuid) from public, anon, authenticated;
grant  execute on function public.course_outline(uuid) to service_role;
