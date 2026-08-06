-- ============================================================================
-- Migration 146 — the reads the three reference screens need
--
-- Screen 1 (shop) wants an instructor and a saved flag on every card.
-- Screen 3 (Learn) is two lists that did not exist as a read at all:
-- certifications earned, and courses in progress with how much is left.
-- ============================================================================

/* ---------------------------------------------------------------- */
/* Shop, with the instructor and the bookmark                        */
/* ---------------------------------------------------------------- */
drop function if exists public.shop_products(uuid);

create function public.shop_products(p_user_id uuid default null)
returns table (
  id uuid, slug text, title text, description text,
  kind text, purpose text, cover_path text, category text,
  instructor_name text, instructor_headline text, instructor_avatar text,
  content_language text,
  price_minor bigint, list_price_minor bigint, on_sale boolean,
  min_affiliate_tier text,
  lessons int, quizzes int, seconds int,
  owned boolean, percent int, saved boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.slug, p.title, p.description,
         p.kind::text, p.purpose::text, p.cover_path, p.category,
         /* The name a BUYER sees. Falls back to the business name so a vendor
            the operator has not written a profile for still renders something
            rather than a blank row where a person should be. */
         coalesce(v.display_name, v.name),
         v.headline,
         v.avatar_path,
         p.content_language,
         public.product_price_minor(p.id),
         p.price_minor,
         public.product_price_minor(p.id) < p.price_minor,
         p.min_affiliate_tier::text,
         (select count(*)::int from public.lessons l
            join public.course_sections s on s.id = l.section_id
           where s.product_id = p.id),
         (select count(*)::int from public.quizzes q
            join public.lessons l on l.id = q.lesson_id
            join public.course_sections s on s.id = l.section_id
           where s.product_id = p.id),
         (select coalesce(sum(l.duration_seconds), 0)::int from public.lessons l
            join public.course_sections s on s.id = l.section_id
           where s.product_id = p.id),
         case when p_user_id is null then false
              else public.has_entitlement(p_user_id, p.id) end,
         case when p_user_id is null then 0
              else public.training_completion_percent(p_user_id, p.id) end,
         case when p_user_id is null then false
              else exists (select 1 from public.saved_products sp
                            where sp.user_id = p_user_id and sp.product_id = p.id) end
    from public.products p
    left join public.vendors v on v.id = p.vendor_id
   where p.status = 'published'
   order by p.purpose desc, p.price_minor;
$$;

/* ---------------------------------------------------------------- */
/* The Learn tab                                                     */
/* ---------------------------------------------------------------- */

/**
 * What somebody has finished, and what they are in the middle of.
 *
 * Two lists in one read because the screen is one screen. Entitlements are the
 * source of "mine" — not orders — so a course granted by a bundle or by an
 * upgrade appears exactly like one bought directly.
 *
 * `lessons_left` is what the reference puts on the row ("08 lectures left"),
 * and it is a better thing to show than a percentage on its own: a percentage
 * says how far you have come, a count says how much is in the way.
 */
create or replace function public.my_learning(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',           c.id,
               'productId',    p.id,
               'slug',         p.slug,
               'title',        p.title,
               'coverPath',    p.cover_path,
               'category',     p.category,
               'grade',        c.grade_percent,
               'issuedAt',     c.issued_at,
               'code',         c.verification_code,
               'instructor',   coalesce(v.display_name, v.name)
             ) order by c.issued_at desc)
        from public.certificates c
        join public.products p on p.id = c.product_id
        left join public.vendors v on v.id = p.vendor_id
       where c.user_id = p_user_id
    ), '[]'::jsonb),

    'ongoing', coalesce((
      select jsonb_agg(x order by x->>'title')
        from (
          select jsonb_build_object(
                   'productId',  p.id,
                   'slug',       p.slug,
                   'title',      p.title,
                   'description', p.description,
                   'coverPath',  p.cover_path,
                   'category',   p.category,
                   'instructor', coalesce(v.display_name, v.name),
                   'percent',    public.training_completion_percent(p_user_id, p.id),
                   'lessons',    (select count(*)::int from public.lessons l
                                    join public.course_sections s on s.id = l.section_id
                                   where s.product_id = p.id),
                   'lessonsLeft', (
                     select count(*)::int
                       from public.lessons l
                       join public.course_sections s on s.id = l.section_id
                      where s.product_id = p.id
                        and not exists (
                          select 1 from public.lesson_progress lp
                           where lp.lesson_id = l.id
                             and lp.user_id = p_user_id
                             and lp.completed_at is not null
                        )
                   )
                 ) as x
            from public.entitlements e
            join public.products p on p.id = e.product_id
            left join public.vendors v on v.id = p.vendor_id
           where e.user_id = p_user_id
             /* Finished courses belong in the certificates list above, not in
                a list called "ongoing" — a completed row with a full bar is a
                trophy, and it already has one. */
             and public.training_completion_percent(p_user_id, p.id) < 100
        ) t
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.shop_products(uuid) from public, anon, authenticated;
grant  execute on function public.shop_products(uuid) to service_role;
revoke execute on function public.my_learning(uuid) from public, anon, authenticated;
grant  execute on function public.my_learning(uuid) to service_role;
