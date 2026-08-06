-- ============================================================================
-- Migration 137 — what the shop shows
--
-- `admin_list_products` returns everything, including drafts, revenue and the
-- publish-blocker count. None of that belongs on a storefront, and the function
-- is super-admin-only anyway.
--
-- So the shop gets its own two reads. They differ from the admin's in three
-- ways that matter:
--
--   1. PUBLISHED ONLY. A draft is work in progress; a paused product is one the
--      operator has deliberately taken off sale. Neither appears.
--   2. NO BUSINESS DATA. No revenue, no sales count, no blocker list. A
--      storefront that leaks how few copies something has sold is worse than
--      one that says nothing.
--   3. THE PRICE IS COMPUTED, NOT LISTED. `product_price_minor` already knows
--      whether a sale is running and whether it is within its dates. The shop
--      must not re-derive that, or a sale that has expired stays visible on the
--      card while checkout charges full price.
--
-- ---------------------------------------------------------------------------
-- `p_user_id` IS OPTIONAL AND ONLY DECIDES "DO I ALREADY OWN THIS"
--
-- The catalogue itself is the same for everyone — this is a shop, not a
-- personalised feed. Passing a user turns on one extra column, `owned`, so the
-- card can say "Open it" instead of offering to sell somebody a thing they
-- bought last week.
-- ============================================================================

create or replace function public.shop_products(p_user_id uuid default null)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  kind text,
  purpose text,
  cover_path text,
  content_language text,
  price_minor bigint,
  list_price_minor bigint,
  on_sale boolean,
  min_affiliate_tier text,
  lessons int,
  owned boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.slug, p.title, p.description,
         p.kind::text, p.purpose::text, p.cover_path, p.content_language,
         public.product_price_minor(p.id),
         p.price_minor,
         -- "On sale" means the price the buyer will actually be charged is
         -- below the list price. Derived from the same function checkout uses,
         -- so a lapsed sale cannot linger on the card.
         public.product_price_minor(p.id) < p.price_minor,
         p.min_affiliate_tier::text,
         (select count(*)::int
            from public.lessons l
            join public.course_sections s on s.id = l.section_id
           where s.product_id = p.id),
         case when p_user_id is null then false
              else public.has_entitlement(p_user_id, p.id) end
    from public.products p
   where p.status = 'published'
   order by p.purpose desc, p.price_minor;
$$;

/**
 * One product, plus enough of its curriculum to show what is inside.
 *
 * The outline is `course_outline`, which returns titles and durations and
 * nothing else — no bodies, no storage paths, no quiz questions. Somebody
 * deciding whether to buy is entitled to see the shape of what they would get;
 * they are not entitled to the contents.
 */
create or replace function public.shop_product(p_slug text, p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.products;
begin
  select * into v_product from public.products
   where slug = p_slug and status = 'published';

  if not found then
    return jsonb_build_object('ok', false);
  end if;

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
      'priceMinor',      public.product_price_minor(v_product.id),
      'listPriceMinor',  v_product.price_minor,
      'onSale',          public.product_price_minor(v_product.id) < v_product.price_minor,
      'minAffiliateTier', v_product.min_affiliate_tier::text,
      'owned', case when p_user_id is null then false
                    else public.has_entitlement(p_user_id, v_product.id) end
    ),
    -- Only present on a training product. What the buyer is really choosing
    -- between is one commission level or two, so that number has to be on the
    -- page rather than inferred from the price.
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

-- Server-only, like every other Phase 2 read: the pages render on the server
-- and call these with the service key.
revoke execute on function public.shop_products(uuid) from public, anon, authenticated;
grant  execute on function public.shop_products(uuid) to service_role;
revoke execute on function public.shop_product(text, uuid) from public, anon, authenticated;
grant  execute on function public.shop_product(text, uuid) to service_role;
