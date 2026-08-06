-- ============================================================================
-- Migration 143 — the admin list did not return what the editor edits
--
-- The product editor reads its initial values off `admin_list_products` (there
-- is deliberately no second per-product read, so the list and the editor cannot
-- disagree about what a product is). Migration 140 added three columns and 142
-- taught the save path to write them — but the READ still did not return them,
-- so the editor would have opened with an empty cover, no topic and no
-- outcomes, and saving would have silently cleared all three.
--
-- Caught before shipping because the TypeScript type was widened first and the
-- SQL was not: the compiler was happy, since `data as unknown as CatalogueRow[]`
-- asserts rather than checks. A cast is a promise, and this migration is the
-- half that keeps it.
-- ============================================================================

drop function if exists public.admin_list_products(text);

create function public.admin_list_products(p_purpose text default null)
returns table (
  id uuid,
  title text,
  slug text,
  kind text,
  purpose text,
  status text,
  vendor_name text,
  cover_path text,
  category text,
  description text,
  learning_outcomes text[],
  price_ghs numeric,
  sale_price_ghs numeric,
  effective_price_ghs numeric,
  content_language text,
  min_affiliate_tier text,
  lessons int,
  sections int,
  blockers int,
  l1_rate numeric,
  l2_rate numeric,
  sales int,
  revenue_ghs numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title, p.slug, p.kind::text, p.purpose::text, p.status::text,
         v.name,
         p.cover_path, p.category, p.description, p.learning_outcomes,
         (p.price_minor / 100.0)::numeric,
         (p.sale_price_minor / 100.0)::numeric,
         (public.product_price_minor(p.id) / 100.0)::numeric,
         p.content_language,
         p.min_affiliate_tier::text,
         (select count(*)::int from public.lessons l
            join public.course_sections s on s.id = l.section_id
           where s.product_id = p.id),
         (select count(*)::int from public.course_sections s where s.product_id = p.id),
         (select count(*)::int from public.product_publish_blockers(p.id)),
         ap.l1_rate_value,
         ap.l2_rate_value,
         (select count(*)::int from public.orders o
           where o.product_id = p.id and o.status = 'confirmed'),
         (select coalesce(sum(o.amount_minor), 0) / 100.0 from public.orders o
           where o.product_id = p.id and o.status = 'confirmed')::numeric,
         p.created_at
    from public.products p
    left join public.vendors v on v.id = p.vendor_id
    left join public.affiliate_programs ap on ap.product_id = p.id
   where p_purpose is null or p.purpose::text = p_purpose
   order by p.created_at desc;
$$;

revoke execute on function public.admin_list_products(text) from public, anon, authenticated;
grant  execute on function public.admin_list_products(text) to service_role;
