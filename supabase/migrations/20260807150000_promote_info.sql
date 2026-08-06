-- ============================================================================
-- Migration 139 — what an affiliate needs before they promote something
--
-- The shop product page grows a second button. A buyer sees "Buy now"; an
-- affiliate sees "Promote" as well, and promoting means answering three
-- questions before they will share anything:
--
--   what do I earn on this
--   am I allowed to promote it
--   what is my link
--
-- All three in one read, because they are one decision.
--
-- ---------------------------------------------------------------------------
-- THE EARNING IS COMPUTED, NOT DESCRIBED
--
-- Returning "30%" and letting the page multiply would put a money calculation
-- in a browser, where it can disagree with `pay_conversion_commissions`. So the
-- cash figure is worked out HERE, with the same inputs and the same rounding
-- the ledger will use — the sale price from `product_price_minor`, the rate off
-- `affiliate_programs`, `round()` on the product.
--
-- If those two ever diverge, an affiliate is shown one number and paid another,
-- and they will screenshot the first one.
--
-- ---------------------------------------------------------------------------
-- ELIGIBILITY IS A REASON, NOT A BOOLEAN
--
-- There are four separate ways to be unable to promote something, and they need
-- four different sentences and four different next steps:
--
--   no_account   never bought training           → sell them the training
--   pending      bought it, not far enough in    → send them to the course
--   lapsed       the year ran out                → offer the renewal
--   tier         needs Professional, has Beginner → offer the upgrade
--
-- A single `can_promote` boolean would collapse all four into "no", which is
-- the least useful thing the screen could say.
-- ============================================================================

create or replace function public.affiliate_promote_info(p_user_id uuid, p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_aff     public.affiliate_accounts;
  v_product public.products;
  v_program public.affiliate_programs;
  v_depth   int := 0;
  v_tier    public.affiliate_tier;
  v_price   bigint;
  v_reason  text;
begin
  select * into v_product from public.products
   where id = p_product_id and status = 'published';
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  v_price := public.product_price_minor(p_product_id);

  select * into v_program from public.affiliate_programs
   where product_id = p_product_id and status = 'active';

  select * into v_aff from public.affiliate_accounts where user_id = p_user_id;

  if not found then
    v_reason := 'no_account';
  elsif v_aff.status = 'suspended' then
    v_reason := 'suspended';
  elsif v_aff.status = 'pending' then
    v_reason := 'pending';
  else
    v_depth := public.affiliate_depth_now(v_aff.id);
    if v_depth = 0 then
      v_reason := 'lapsed';
    else
      /* The highest tier they currently hold. `professional` outranks
         `beginner`, and the enum's own order is what says so — comparing the
         text would put 'beginner' above 'professional' alphabetically. */
      select max(tp.level) into v_tier
        from public.affiliate_entitlements e
        join public.training_programs tp on tp.id = e.training_program_id
       where e.affiliate_id = v_aff.id
         and e.status = 'active'
         and e.grace_ends_at > now();

      if v_tier < v_product.min_affiliate_tier then
        v_reason := 'tier';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'canPromote', v_reason is null and v_program.id is not null,
    'reason',     v_reason,
    'code',       v_aff.affiliate_code,
    'tier',       v_tier::text,
    'depth',      v_depth,
    'minTier',    v_product.min_affiliate_tier::text,
    'priceMinor', v_price,
    'l1Rate',     v_program.l1_rate_value,
    'l2Rate',     v_program.l2_rate_value,
    -- The money, worked out the way the ledger will work it out.
    'l1EarnMinor', case when v_program.l1_rate_value is null then null
                        else round(v_price * v_program.l1_rate_value / 100)::bigint end,
    'l2EarnMinor', case when v_program.l2_rate_value is null or v_depth < 2 then null
                        else round(v_price * v_program.l2_rate_value / 100)::bigint end,
    'windowDays', coalesce(v_program.attribution_window_hours, 720) / 24,
    'holdDays',   coalesce(v_program.hold_days, 0)
  );
end;
$$;

revoke execute on function public.affiliate_promote_info(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_promote_info(uuid, uuid) to service_role;
