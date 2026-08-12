-- ============================================================================
-- Migration 186 — an upgrade charges the difference, whichever door you use
--
-- Operator, 2026-08-12: the manager account holds Beginner, and upgrading to
-- Professional asked for the full GHS 350 rather than the GHS 200 difference.
--
-- ── THE FUNCTION WAS RIGHT AND NOTHING CALLED IT ──
--
-- `start_training_upgrade` has computed `target price − what they paid`
-- correctly since migration 129. It is granted. It is tested. And the only
-- route to an upgrade in the product is the panel on /market/account, whose
-- button links to `/p/<slug>` — the ordinary product page, whose Buy button
-- calls `start_product_order` and charges the list price.
--
-- The same shape as the eight admin RPCs that had no screen on 2026-08-07:
-- correct SQL nobody reaches. A test proved the arithmetic and could not
-- notice that no path in the product ever ran it.
--
-- ── THE FIX IS IN THE DATABASE, NOT IN A BUTTON ──
--
-- Moving the panel onto a different action would leave the front door open:
-- anybody who reaches /p/affiliate-training-professional directly, or follows
-- an affiliate's link to it, would still be charged in full. So
-- `start_product_order` now recognises the case itself. If the buyer already
-- holds a lower training entitlement, the order IS an upgrade and is priced as
-- one, whichever screen asked for it.
--
-- That also lands it in the right order kind, which matters beyond the price:
-- `attribute_order` pays an upgrade's commission to the buyer's UPLINE rather
-- than to the last click (B8), and on the difference rather than the full
-- price. Charging full price through the purchase path was quietly paying the
-- wrong person the wrong amount as well.
--
-- ⚠️ A COUPON IS NOT APPLIED ON THE UPGRADE PATH. `start_training_upgrade`
-- takes no code, and coupons default to first purchases anyway. Worth knowing
-- before somebody writes an upgrade promotion.
--
-- ── AND THE OFFER NOW SAYS WHAT IT COSTS ──
--
-- `training_upgrade_offer` returned `price_minor`, the list price, which is
-- what the panel's button was advertising. It now also returns
-- `upgrade_minor`, computed exactly as the charge is, so the screen can quote
-- the figure that will actually be taken.
-- ============================================================================

/*
  ⚠️ THE LIVE BODY, RESTATED, WITH ONE KEY ADDED. I first rewrote this from
  memory and got three things wrong: it reads `course_sections` not `modules`,
  eligibility is `training_level_rank` against `owned_training_rank` rather
  than a depth comparison, and it is a plain SQL function. That is the same
  mistake that cost migration 180 this morning. `pg_get_functiondef` first.
*/
create or replace function public.training_upgrade_offer(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'product_id', pr.id, 'slug', pr.slug, 'title', pr.title,
           'description', pr.description, 'level', tp.level::text,
           'price_minor', public.product_price_minor(pr.id),
           /* WHAT IT WILL ACTUALLY COST: the target's price less what they
              paid for what they hold, which is exactly what
              `start_training_upgrade` charges. Two places computing one figure
              is how a screen advertises a price the till does not honour, so
              if this moves, move both. */
           'upgrade_minor', greatest(
              public.product_price_minor(pr.id)
                - coalesce((select max(o.amount_minor)
                              from public.affiliate_entitlements ae
                              join public.orders o on o.id = ae.order_id
                              join public.affiliate_accounts a on a.id = ae.affiliate_id
                             where a.user_id = p_user_id and ae.status = 'active'), 0),
              0),
           'lessons', (select count(*)::int from public.lessons l
                         join public.course_sections s on s.id = l.section_id
                        where s.product_id = pr.id),
           'depth', tp.commission_depth,
           'validity_days', tp.validity_days,
           'certificate', tp.certificate_enabled
         )
    from public.training_programs tp
    join public.products pr on pr.id = tp.product_id
   where pr.status = 'published'
     and public.training_level_rank(tp.level::text) > public.owned_training_rank(p_user_id)
   order by public.training_level_rank(tp.level::text)
   limit 1;
$$;


-- ---------------------------------------------------------------------------
-- Whichever door: an upgrade is priced as an upgrade
-- ---------------------------------------------------------------------------

create or replace function public.start_product_order(
  p_user_id uuid,
  p_product_id uuid,
  p_method public.order_payment_method,
  p_coupon_code text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product  public.products;
  v_profile  public.profiles;
  v_amount   bigint;
  v_charge   bigint;
  v_take     record;
  v_coupon   uuid;
  v_discount bigint := 0;
  v_target   public.training_programs;
  v_account  public.affiliate_accounts;
  v_held     int;
  v_row      public.orders;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  if v_profile.disabled_at is not null then
    raise exception 'This account is disabled' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'Unknown product' using errcode = 'check_violation';
  end if;
  if v_product.status <> 'published' then
    raise exception 'That product is not on sale' using errcode = 'check_violation';
  end if;

  /* Already owned? Refuse rather than take the money. Buying something twice
     is never what somebody meant, and the entitlement upsert would silently
     make the second payment buy nothing at all. */
  if public.has_entitlement(p_user_id, p_product_id) then
    raise exception 'You already own %', v_product.title using errcode = 'check_violation';
  end if;

  /* ⚠️ AN UPGRADE, NOT A PURCHASE. Somebody who already holds a lower
     training and asks for a higher one is upgrading, whatever screen they came
     from, and an upgrade costs the difference. Delegating rather than
     duplicating the arithmetic: `start_training_upgrade` owns it. */
  if v_product.purpose = 'training_program' then
    select * into v_target from public.training_programs where product_id = p_product_id;
    select * into v_account from public.affiliate_accounts where user_id = p_user_id;

    if found and v_target.id is not null then
      select coalesce(max(e.commission_depth), 0) into v_held
        from public.affiliate_entitlements e
       where e.affiliate_id = v_account.id and e.status = 'active';

      if v_held > 0 and v_held < v_target.commission_depth then
        return public.start_training_upgrade(p_user_id, v_target.id, p_method);
      end if;
    end if;
  end if;

  /* The price on sale today, which a coupon then comes off. */
  v_amount := public.product_price_minor(p_product_id);
  v_charge := v_amount;

  if nullif(btrim(coalesce(p_coupon_code, '')), '') is not null then
    select * into v_take
      from public.take_coupon(p_user_id, p_coupon_code, null, p_product_id, v_amount, 'purchase');
    v_charge   := v_take.charged_minor;
    v_coupon   := v_take.coupon_id;
    v_discount := v_take.discount_minor;
  end if;

  insert into public.orders
    (user_id, product_id, kind, amount_minor, list_price_minor, method, status)
  values
    (p_user_id, p_product_id, 'purchase', v_charge, v_product.price_minor, p_method, 'pending')
  returning * into v_row;

  if v_coupon is not null then
    insert into public.coupon_redemptions
      (coupon_id, user_id, order_id, list_minor, discount_minor, charged_minor)
    values
      (v_coupon, p_user_id, v_row.id, v_amount, v_discount, v_charge);
  end if;

  return v_row;
end;
$$;

revoke execute on function public.start_product_order(uuid, uuid, public.order_payment_method, text)
  from public, anon, authenticated;
grant execute on function public.start_product_order(uuid, uuid, public.order_payment_method, text)
  to service_role;
