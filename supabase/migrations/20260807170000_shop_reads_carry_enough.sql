-- ============================================================================
-- Migration 141 — the shop reads did not carry enough to draw a card
--
-- Measured against the references, every card was missing most of what makes
-- one worth looking at. Some of that was rendering, but some of it was that the
-- read simply did not return it:
--
--   cover           returned, never rendered (migration 140 fixes the writing)
--   author          `vendor_name` was in the ADMIN list and not the shop one
--   duration        never computed anywhere — "1h 20m" is on every reference
--                   card and we only ever counted lessons
--   quizzes         part of "what is in this course" and never surfaced
--   category        new in 140, needed for the filter chips
--   progress        an owned course shows a progress bar in 0572; the shop
--                   knew whether you owned it and not how far in you were
--   outcomes        "What'll you learn", the biggest block on 0578
--
-- None of this is new information — it is all derivable from rows that already
-- existed. It was simply never asked for, which is why the cards had nothing on
-- them.
--
-- ---------------------------------------------------------------------------
-- DURATION IS SUMMED, NOT STORED
--
-- No column holds a course's total length, and adding one would create a second
-- source of truth that goes stale the moment a lesson is edited. Summing
-- `duration_seconds` costs one aggregate over a table that will hold hundreds
-- of rows, not millions, and it cannot disagree with the curriculum.
-- ============================================================================

/* The return type gains columns, and Postgres will not replace a function
   whose OUT parameters changed — it has to be dropped first. Stated here so a
   fresh database applies this file without a manual step. */
drop function if exists public.shop_products(uuid);

create function public.shop_products(p_user_id uuid default null)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  kind text,
  purpose text,
  cover_path text,
  category text,
  vendor_name text,
  content_language text,
  price_minor bigint,
  list_price_minor bigint,
  on_sale boolean,
  min_affiliate_tier text,
  lessons int,
  quizzes int,
  seconds int,
  owned boolean,
  percent int
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.slug, p.title, p.description,
         p.kind::text, p.purpose::text, p.cover_path, p.category,
         v.name,
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
         -- How far through, so an owned card can carry the progress bar the
         -- reference puts on one. Zero for anybody who does not own it.
         case when p_user_id is null then 0
              else public.training_completion_percent(p_user_id, p.id) end
    from public.products p
    left join public.vendors v on v.id = p.vendor_id
   where p.status = 'published'
   order by p.purpose desc, p.price_minor;
$$;

create or replace function public.shop_product(p_slug text, p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_vendor  text;
begin
  select * into v_product from public.products
   where slug = p_slug and status = 'published';

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select name into v_vendor from public.vendors where id = v_product.vendor_id;

  return jsonb_build_object(
    'ok', true,
    'product', jsonb_build_object(
      'id',           v_product.id,
      'slug',         v_product.slug,
      'title',        v_product.title,
      'description',  v_product.description,
      'kind',         v_product.kind::text,
      'purpose',      v_product.purpose::text,
      'coverPath',    v_product.cover_path,
      'category',     v_product.category,
      'vendorName',   v_vendor,
      'outcomes',     to_jsonb(v_product.learning_outcomes),
      'updatedAt',    v_product.updated_at,
      'priceMinor',      public.product_price_minor(v_product.id),
      'listPriceMinor',  v_product.price_minor,
      'onSale',          public.product_price_minor(v_product.id) < v_product.price_minor,
      'minAffiliateTier', v_product.min_affiliate_tier::text,
      'owned', case when p_user_id is null then false
                    else public.has_entitlement(p_user_id, v_product.id) end,
      'percent', case when p_user_id is null then 0
                      else public.training_completion_percent(p_user_id, v_product.id) end,
      'lessons', (select count(*)::int from public.lessons l
                    join public.course_sections s on s.id = l.section_id
                   where s.product_id = v_product.id),
      'quizzes', (select count(*)::int from public.quizzes q
                    join public.lessons l on l.id = q.lesson_id
                    join public.course_sections s on s.id = l.section_id
                   where s.product_id = v_product.id),
      'seconds', (select coalesce(sum(l.duration_seconds), 0)::int from public.lessons l
                    join public.course_sections s on s.id = l.section_id
                   where s.product_id = v_product.id)
    ),
    'training', (
      select jsonb_build_object(
               'level',            tp.level::text,
               'commissionDepth',  tp.commission_depth,
               'validityDays',     tp.validity_days,
               'renewalPriceMinor', tp.renewal_price_minor,
               'activationThreshold', tp.activation_threshold_percent,
               'certificate',      tp.certificate_enabled
             )
        from public.training_programs tp where tp.product_id = v_product.id
    ),
    'sections', coalesce((
      select jsonb_agg(x order by x->>'position')
        from (
          select jsonb_build_object(
                   'title',    s.title,
                   'position', s.position,
                   'lessons', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'title',    l.title,
                              'kind',     l.kind::text,
                              'seconds',  l.duration_seconds,
                              'preview',  l.is_preview
                            ) order by l.position)
                       from public.lessons l where l.section_id = s.id
                   ), '[]'::jsonb)
                 ) as x
            from public.course_sections s
           where s.product_id = v_product.id
        ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.shop_products(uuid) from public, anon, authenticated;
grant  execute on function public.shop_products(uuid) to service_role;
revoke execute on function public.shop_product(text, uuid) from public, anon, authenticated;
grant  execute on function public.shop_product(text, uuid) to service_role;
