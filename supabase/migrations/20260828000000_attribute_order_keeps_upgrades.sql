-- ============================================================================
-- Migration 180 — put the upgrade path back into `attribute_order`
--
-- ⚠️ A REGRESSION I SHIPPED IN MIGRATION 179, CAUGHT BY THE SUITE.
--
-- Three tests went red: "pays the UPLINE, not whoever they last clicked",
-- "pays on the difference, not on the full price", and the ops screen that
-- says an upgrade paid the upline.
--
-- ── HOW ──
--
-- 179 needed one line changed in `attribute_order` (the commission base adds
-- the coupon back). I rebuilt the function from migration 121
-- (`phase2_click_ordering`), which is where I had read it. But 121 is not the
-- last word on that function: migration 129 (`phase2_renewal_upgrade`) rewrote
-- it to handle `training_upgrade`, and its timestamp is LATER. Restating the
-- older body therefore deleted the whole upgrade branch, silently, while every
-- coupon test passed.
--
-- What went missing, all of it decision B8: an upgrade has no click, so the
-- earner is the buyer's UPLINE rather than whoever they last clicked, a lapsed
-- upline earns nothing, and self-referral is checked on whichever route got
-- there. Without it an upgrade found no click and returned null, so nobody was
-- paid at all.
--
-- ── THE RULE THIS BREAKS, AGAIN ──
--
-- `[[crypto-payouts-denominated-in-coin]]` already says it: read the LIVE
-- function definition before rewriting one, never the migration that first
-- created it. `pg_get_functiondef` is one query. I checked the live body of
-- `confirm_product_order` in that same session and did not check this one,
-- which is the only difference between a clean change and this.
--
-- The body below is migration 129's, restated exactly, with the single coupon
-- line from 179 folded in and nothing else touched.
-- ============================================================================

create or replace function public.attribute_order(
  p_order_id uuid,
  p_visitor_token text default null
)
returns public.conversions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order      public.orders;
  v_program    public.affiliate_programs;
  v_click      public.affiliate_clicks;
  v_buyer      public.affiliate_accounts;
  v_earner     uuid;
  v_click_id   uuid;
  v_subid      text;
  v_parent     public.affiliate_accounts;
  v_l2_depth   int;
  v_l2_ent     uuid;
  v_l2_id      uuid;
  v_l2_rate    numeric(6,3);
  v_base       bigint;
  v_conversion public.conversions;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Unknown order' using errcode = 'check_violation';
  end if;

  select * into v_conversion from public.conversions where order_id = p_order_id;
  if found then
    return v_conversion;
  end if;

  -- B11c. Pays nobody, at any level, and leaves before anything is written.
  if v_order.kind = 'training_renewal' then
    return null;
  end if;

  select * into v_program from public.affiliate_programs
   where product_id = v_order.product_id and status = 'active';
  if not found then
    return null;
  end if;

  select * into v_buyer from public.affiliate_accounts where user_id = v_order.user_id;

  if v_order.kind = 'training_upgrade' then
    /* No click. The earner is whoever recruited them, if that person may
       still earn at all — a lapsed upline gets nothing, the same rule that
       governs an override. */
    if v_buyer.id is null or v_buyer.parent_affiliate_id is null then
      return null;
    end if;
    if public.affiliate_depth_now(v_buyer.parent_affiliate_id) < 1 then
      return null;
    end if;
    v_earner   := v_buyer.parent_affiliate_id;
    v_click_id := null;
    v_subid    := null;
  else
    select * into v_click
      from public.affiliate_clicks c
     where c.product_id = v_order.product_id
       and c.created_at > now() - make_interval(hours => v_program.attribution_window_hours)
       and (
         (p_visitor_token is not null and c.visitor_token = p_visitor_token)
         or c.user_id = v_order.user_id
       )
     order by c.created_at desc, c.id desc
     limit 1;

    if not found then
      return null;
    end if;

    v_earner   := v_click.affiliate_id;
    v_click_id := v_click.id;
    v_subid    := v_click.subid;
  end if;

  -- Self-referral, whichever route got here.
  if v_buyer.id is not null and v_buyer.id = v_earner then
    return null;
  end if;

  -- ---- C22: resolve level two NOW, and write down what was true ----------
  select * into v_parent from public.affiliate_accounts
   where id = (select parent_affiliate_id from public.affiliate_accounts where id = v_earner);

  if found and v_parent.id is not null and v_parent.id <> v_earner then
    v_l2_depth := public.affiliate_depth_now(v_parent.id);
    if v_l2_depth >= 2 then
      v_l2_id := v_parent.id;
      v_l2_rate := v_program.l2_rate_value;
      select id into v_l2_ent from public.affiliate_entitlements
       where affiliate_id = v_parent.id and status = 'active' and grace_ends_at > now()
       order by commission_depth desc, expires_at desc limit 1;
    end if;
  end if;

  /* THE ONE LINE FROM 179. The coupon is added back, and only the coupon: an
     affiliate's commission must not shrink because the platform ran a
     promotion (operator, 2026-08-11). A product's own sale price is NOT added
     back, and for an upgrade `amount_minor` is the difference being paid, so
     an upgrade still pays on the difference rather than the full price. With
     no coupon on the order this is `amount_minor`, exactly as before. */
  select v_order.amount_minor + coalesce(sum(r.discount_minor), 0)
    into v_base
    from public.coupon_redemptions r
   where r.order_id = v_order.id;

  insert into public.conversions
    (order_id, affiliate_id, click_id, subid, program_id,
     l1_rate, l2_affiliate_id, l2_rate, l2_entitlement_id, l2_depth_at_conversion,
     base_minor)
  values
    (p_order_id, v_earner, v_click_id, v_subid, v_program.id,
     v_program.l1_rate_value, v_l2_id, v_l2_rate, v_l2_ent, v_l2_depth,
     v_base)
  returning * into v_conversion;

  return v_conversion;
end;
$$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;
