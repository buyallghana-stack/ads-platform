-- ============================================================================
-- Migration 151 — the marketplace card shows what the product pays
--
-- The affiliate marketplace is a grid of products, and the reference puts two
-- figures on every card:
--
--     Commission              Earnings / Sale
--     30%                     GHS 60.00
--
-- That is the only information on the card that decides anything. A title and
-- a cover say what a product IS; the rate and the cash say whether it is worth
-- an afternoon of promoting, and without them the grid is a catalogue rather
-- than a workspace.
--
-- `shop_products` did not carry either. The per-product read that does —
-- `affiliate_promote_info` — answers for ONE product, so a grid of twenty
-- would be twenty round trips. This adds the same three values to the list.
--
-- ---------------------------------------------------------------------------
-- THE CASH FIGURE IS COMPUTED HERE, DELIBERATELY
--
-- `round(price * rate / 100)` in Postgres, exactly as `affiliate_promote_info`
-- and `pay_conversion_commissions` do it. Never `price * rate / 100` in a
-- browser: JavaScript rounds a half away from zero on a float, Postgres rounds
-- a numeric half away from zero on an exact value, and the two disagree on
-- amounts ending in a half pesewa. The card would then advertise GHS 60.01
-- against a ledger that pays GHS 60.00 — small, permanent, and precisely the
-- kind of discrepancy an affiliate keeps a screenshot of.
--
-- ---------------------------------------------------------------------------
-- WHY `can_promote` IS PER-ROW AND NOT PER-USER
--
-- Eligibility is not a property of the affiliate alone. `min_affiliate_tier`
-- lives on the PRODUCT, so a beginner-tier affiliate can promote some of this
-- grid and not the rest, and a card that offers "Promote" on something they
-- will be refused is worse than one that explains why not.
--
-- The rate is still shown on a product they cannot promote yet. It is what
-- they would earn if they upgraded, which is the entire argument for
-- upgrading, and hiding it would make the tier gate look arbitrary.
--
-- ---------------------------------------------------------------------------
-- SIGNED-OUT AND NON-AFFILIATE CALLERS
--
-- `p_user_id` is still optional and the shop is still public. With no user,
-- `can_promote` is false and the rate is whatever the program publishes — the
-- same figures a signed-out visitor sees on the public product page, which is
-- already public information.
-- ============================================================================

drop function if exists public.shop_products(uuid);

create or replace function public.shop_products(p_user_id uuid default null::uuid)
returns table(
  id uuid, slug text, title text, description text, kind text, purpose text,
  cover_path text, category text,
  instructor_name text, instructor_headline text, instructor_avatar text,
  content_language text,
  price_minor bigint, list_price_minor bigint, on_sale boolean,
  min_affiliate_tier text,
  lessons integer, quizzes integer, seconds integer,
  owned boolean, percent integer, saved boolean,
  l1_rate numeric, l1_earn_minor bigint, can_promote boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with me as (
    select a.id as affiliate_id,
           a.status,
           public.affiliate_depth_now(a.id) as depth,
           (select max(tp.level)
              from public.affiliate_entitlements e
              join public.training_programs tp on tp.id = e.training_program_id
             where e.affiliate_id = a.id
               and e.status = 'active'
               and e.grace_ends_at > now()) as tier
      from public.affiliate_accounts a
     where p_user_id is not null and a.user_id = p_user_id
  )
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
                            where sp.user_id = p_user_id and sp.product_id = p.id) end,

         /* --- what it pays -------------------------------------------- */
         ap.l1_rate_value,
         case when ap.l1_rate_value is null then null
              else round(public.product_price_minor(p.id) * ap.l1_rate_value / 100)::bigint
         end,
         /* An active program, an account in good standing, an unexpired
            entitlement, and a tier that clears this product's floor. All four,
            or the card offers something that would be refused. */
         (ap.id is not null
          and exists (select 1 from me
                       where me.status = 'active'
                         and me.depth > 0
                         and me.tier >= p.min_affiliate_tier))

    from public.products p
    left join public.vendors v on v.id = p.vendor_id
    left join public.affiliate_programs ap
           on ap.product_id = p.id and ap.status = 'active'
   where p.status = 'published'
   order by p.purpose desc, p.price_minor;
$function$;

comment on function public.shop_products(uuid) is
  'The marketplace grid. `l1_earn_minor` is rounded in Postgres with the same expression the ledger uses — never multiplied in a browser, or the card advertises a figure the payout does not match. `can_promote` is per ROW because min_affiliate_tier lives on the product.';

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC. Phase 2 is server-only. */
revoke execute on function public.shop_products(uuid) from public, anon, authenticated;
grant  execute on function public.shop_products(uuid) to service_role;
