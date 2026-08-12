-- ============================================================================
-- Migration 179 — a coupon reaches both checkouts
--
-- Migration 178 built the codes and the rules. This is the part that takes
-- money, and it changes three things that are easy to get wrong.
--
-- ── 1. TWO AMOUNTS ON AN ADS PAYMENT ──
--
-- Ads plans are bands, and `resolve_user_tier` reads
-- `user_subscriptions.amount_minor` to decide the buyer's rate and their daily
-- limit. A coupon names its tier and therefore cannot move anybody between
-- bands, so the discount must reduce the money received WITHOUT reducing the
-- plan. That needs two numbers where there was one:
--
--   subscription_payments.amount_minor   what Paystack charges. Revenue.
--   subscription_payments.list_minor     what the plan was priced at. Benefits.
--
-- `confirm_subscription_payment` writes the LIST figure into
-- `user_subscriptions.amount_minor`, so a Platinum buyer with half off holds
-- Platinum. Finance keeps reading `amount_minor` and sees what actually
-- arrived. `resolve_user_tier` is not touched at all, which is the point of
-- doing it this way.
--
-- ⚠️ THE SUBSIDY IS ONGOING, NOT A ONE-OFF. Somebody who pays GHS 260 for
-- Platinum earns at Platinum's rate for the whole period. A coupon is a
-- decision about the next 90 days of points, not about one checkout.
--
-- ── 2. COMMISSION IS PAID ON THE PRICE BEFORE THE COUPON ──
--
-- Operator, 2026-08-11: an affiliate's commission must not shrink because the
-- platform ran a promotion. So `conversions.base_minor` becomes what the buyer
-- would have paid without the code.
--
-- Note what that is NOT: it is not `list_price_minor`. A product can carry a
-- SALE price (`products.sale_price_minor`), and `orders.list_price_minor` is
-- the catalogue price above it. Basing commission on the catalogue price would
-- pay 30% of GHS 200 on a product deliberately sold at GHS 50, forever, with
-- no coupon anywhere in the story. The operator's decision was about their own
-- promotion, so it is their own promotion that is added back:
--
--   base = orders.amount_minor + the coupon discount on that order
--
-- A sale-priced product with no coupon therefore pays exactly what it pays
-- today. Nothing that exists changes.
--
-- The guarantee this breaks is real and worth naming: commission can now
-- exceed the money a single sale brought in. `admin_save_coupon` is what keeps
-- it bounded, refusing any code that takes off more than 100 minus the two
-- commission rates. That guard is the only thing standing between this rule
-- and a ledger that pays out more than it takes.
--
-- ── 3. THE ADS REFERRAL COMMISSION IS DELIBERATELY LEFT ALONE ──
--
-- `pay_referral_purchase_commission` pays the Phase 1 referrer for an ads
-- subscription, and it computes from the payment with its own comment saying
-- why: "so a plan re-priced between purchase and confirmation cannot pay a
-- commission on money never received". The operator's decision was about the
-- affiliate commission on training. Extending it here would be a second money
-- change nobody asked for, on a path whose rates are currently zero, so it
-- keeps paying on what was received and this migration says so out loud rather
-- than leaving the inconsistency to be discovered.
-- ============================================================================


alter table public.subscription_payments
  add column if not exists list_minor bigint;

comment on column public.subscription_payments.list_minor is
  'What the plan was priced at before any coupon, which is what the buyer''s benefits are worth. Null when no coupon was used, in which case it equals amount_minor. Never use this as revenue: amount_minor is the money that arrived.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_list_not_below_charge') then
    alter table public.subscription_payments
      add constraint subscription_payments_list_not_below_charge
      check (list_minor is null or list_minor >= amount_minor);
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Taking a code, in the one place that may
-- ---------------------------------------------------------------------------
--
-- Locks the coupon row before quoting, so two people cannot both take the last
-- place in a quota. The lock is held to the end of the transaction, which for
-- both callers is the end of the checkout row being written.
--
-- Raises rather than returning a failure: by the time money is being taken the
-- buyer has already been shown a price by `coupon_quote`, so anything failing
-- here is a race or a tampered request, not a person mistyping a code.

create or replace function public.take_coupon(
  p_user_id      uuid,
  p_code         text,
  p_tier_id      uuid,
  p_product_id   uuid,
  p_amount_minor bigint,
  p_kind         public.order_kind default 'purchase'
)
returns table (coupon_id uuid, discount_minor bigint, charged_minor bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q record;
  v_locked uuid;
begin
  select c.id into v_locked
    from public.coupons c
   where upper(c.code) = upper(btrim(coalesce(p_code, '')))
   for update;

  if v_locked is null then
    raise exception 'That code is not recognised' using errcode = 'check_violation';
  end if;

  select * into v_q
    from public.coupon_quote(p_user_id, p_code, p_tier_id, p_product_id, p_amount_minor, p_kind);

  if not v_q.ok then
    raise exception '%', case v_q.reason
      when 'inactive'            then 'That code is no longer active'
      when 'not_started'         then 'That code cannot be used yet'
      when 'expired'             then 'That code has expired'
      when 'wrong_target'        then 'That code is not for this purchase'
      when 'first_purchase_only' then 'That code is for a first purchase only'
      when 'min_spend'           then 'That code needs a larger purchase'
      when 'already_used'        then 'You have already used that code'
      when 'exhausted'           then 'That code has been fully used'
      when 'nothing_off'         then 'That code takes nothing off this purchase'
      else 'That code cannot be used here'
    end using errcode = 'check_violation';
  end if;

  coupon_id      := v_q.coupon_id;
  discount_minor := v_q.discount_minor;
  charged_minor  := v_q.charged_minor;
  return next;
end;
$$;

revoke execute on function public.take_coupon(uuid, text, uuid, uuid, bigint, public.order_kind)
  from public, anon, authenticated;
grant execute on function public.take_coupon(uuid, text, uuid, uuid, bigint, public.order_kind)
  to service_role;


-- ---------------------------------------------------------------------------
-- The ads checkout
-- ---------------------------------------------------------------------------
--
-- ⚠️ DROPPED AND RECREATED, not replaced. A new parameter with a default makes
-- an OVERLOAD, and every existing four-argument call would then be ambiguous
-- and fail. Dropping re-grants EXECUTE to PUBLIC, so the grants are restated
-- at the bottom exactly as they were: service_role only.

drop function if exists public.start_subscription_payment(uuid, uuid, public.subscription_payment_method, bigint);

create or replace function public.start_subscription_payment(
  p_user_id uuid,
  p_tier_id uuid,
  p_method public.subscription_payment_method,
  p_amount_minor bigint default null,
  p_coupon_code text default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier   public.tiers;
  v_row    public.subscription_payments;
  v_prof   public.profiles;
  v_max    bigint;
  v_amount bigint;
  v_take   record;
  v_charge bigint;
  /* Separate from the record on purpose: reading a field of a record that was
     never assigned raises, so "was a coupon used" cannot be asked of `v_take`
     itself on the no-coupon path. */
  v_coupon   uuid;
  v_discount bigint := 0;
begin
  select * into v_prof from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  if v_prof.disabled_at is not null then
    raise exception 'This account is disabled' using errcode = 'check_violation';
  end if;

  select * into v_tier from public.tiers where id = p_tier_id;
  if not found or not v_tier.is_active then
    raise exception 'That tier is not available' using errcode = 'check_violation';
  end if;

  if v_tier.is_default or v_tier.price_minor = 0 then
    raise exception 'The % tier is free and does not need a subscription', v_tier.name
      using errcode = 'check_violation';
  end if;

  /*
    Null means "the plain price", which keeps every existing caller working
    and makes the floor the default rather than something a client has to
    know.
  */
  v_amount := coalesce(p_amount_minor, v_tier.price_minor);
  v_max    := public.plan_band_max_minor(p_tier_id);

  /* ⚠️ THE BAND IS CHECKED AGAINST THE CHOSEN AMOUNT, BEFORE ANY DISCOUNT.
     Checking the discounted figure would make a coupon a way to buy a plan
     below its own floor, which is exactly the thing bands exist to prevent. */
  if v_amount < v_tier.price_minor then
    raise exception 'The least you can pay for % is %', v_tier.name,
      to_char(v_tier.price_minor / 100.0, 'FM999999990.00')
      using errcode = 'check_violation';
  end if;

  if v_amount > v_max then
    raise exception 'The most you can pay for % is %', v_tier.name,
      to_char(v_max / 100.0, 'FM999999990.00')
      using errcode = 'check_violation';
  end if;

  /* Whole pesewas only. A fractional minor unit is not money, and Paystack
     would reject it after the user had already been sent to pay. */
  if v_amount <> floor(v_amount) then
    raise exception 'That amount is not a whole number of pesewas' using errcode = 'check_violation';
  end if;

  v_charge := v_amount;

  if nullif(btrim(coalesce(p_coupon_code, '')), '') is not null then
    select * into v_take
      from public.take_coupon(p_user_id, p_coupon_code, p_tier_id, null, v_amount, 'purchase');
    v_charge   := v_take.charged_minor;
    v_coupon   := v_take.coupon_id;
    v_discount := v_take.discount_minor;
  end if;

  insert into public.subscription_payments (
    user_id, tier_id, method, amount_minor, list_minor, currency_code, period_days
  )
  values (
    p_user_id, p_tier_id, p_method, v_charge,
    /* Only when they differ. A list price equal to the charge is noise in
       every report that reads this table. */
    case when v_charge <> v_amount then v_amount else null end,
    v_tier.currency_code, v_tier.billing_period_days
  )
  returning * into v_row;

  if v_coupon is not null then
    insert into public.coupon_redemptions
      (coupon_id, user_id, subscription_payment_id, list_minor, discount_minor, charged_minor)
    values
      (v_coupon, p_user_id, v_row.id, v_amount, v_discount, v_charge);
  end if;

  return v_row;
end;
$$;

revoke execute on function public.start_subscription_payment(uuid, uuid, public.subscription_payment_method, bigint, text)
  from public, anon, authenticated;
grant execute on function public.start_subscription_payment(uuid, uuid, public.subscription_payment_method, bigint, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- Confirming it: the plan is worth the LIST amount
-- ---------------------------------------------------------------------------

create or replace function public.confirm_subscription_payment(
  p_payment_id uuid,
  p_reference text,
  p_payload jsonb default '{}'::jsonb
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay       public.subscription_payments;
  v_sub       public.user_subscriptions;
  v_grace     int;
  v_from      timestamptz;
  v_end       timestamptz;
  v_live      int;
  v_max_plans int;
  v_worth     bigint;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  /*
    Idempotent by design: a Paystack webhook and the browser callback both
    confirm the same payment, and the webhook may be retried. Returning the
    subscription for THIS payment's tier makes a repeat call a no-op rather
    than a second period or a second row — or a second commission.
  */
  if v_pay.status = 'confirmed' then
    select * into v_sub from public.user_subscriptions
     where user_id = v_pay.user_id and tier_id = v_pay.tier_id
       and status in ('active','grace')
     limit 1;
    return v_sub;
  end if;

  if v_pay.status <> 'pending' then
    raise exception 'Payment is % and cannot be confirmed', v_pay.status
      using errcode = 'check_violation';
  end if;

  update public.subscription_payments
     set status = 'confirmed', confirmed_at = now(),
         external_reference = p_reference,
         provider_payload = coalesce(p_payload, '{}'::jsonb)
   where id = p_payment_id;

  v_grace := public.config_int('subscription_grace_period_days')::int;

  /* WHAT THE PLAN IS WORTH, which is not always what was paid. A coupon names
     its tier and so cannot move anybody between bands: it takes money off the
     charge and leaves the plan alone. `list_minor` is null unless a coupon was
     used, so every payment made before coupons existed reads exactly as it
     did. */
  v_worth := coalesce(v_pay.list_minor, v_pay.amount_minor);

  -- Renewing THIS plan: extend from whichever is later, so a user who renews
  -- early is not punished by losing the remainder.
  select * into v_sub from public.user_subscriptions
   where user_id = v_pay.user_id
     and tier_id = v_pay.tier_id
     and status in ('active','grace')
   for update;

  if found then
    v_from := greatest(v_sub.current_period_end, now());
    v_end  := v_from + make_interval(days => v_pay.period_days);

    update public.user_subscriptions
       set status             = 'active',
           current_period_end = v_end,
           grace_ends_at      = v_end + make_interval(days => v_grace),
           -- What they last paid for this plan is what it is worth. Adding it
           -- to the old amount would let somebody renew their way up the
           -- ladder without ever holding more than one plan.
           amount_minor       = v_worth,
           cancelled_at       = null,
           updated_at         = now()
     where id = v_sub.id
    returning * into v_sub;

    begin
      perform public.pay_referral_purchase_commission(p_payment_id);
    exception when others then
      insert into public.system_alerts (severity, code, message, context)
      values ('warning', 'referral_commission_failed',
              'A subscription was confirmed but its referral commission could not be paid.',
              jsonb_build_object('payment_id', p_payment_id, 'error', sqlerrm, 'sqlstate', sqlstate));
    end;

    return v_sub;
  end if;

  -- A DIFFERENT plan: it is added alongside. Nothing already held is touched.
  select count(*), coalesce((select value::int from public.app_config
                              where key = 'subscription_max_stacked_plans'), 4)
    into v_live, v_max_plans
    from public.user_subscriptions
   where user_id = v_pay.user_id and status in ('active','grace');

  if v_live >= v_max_plans then
    raise exception 'This account already holds the maximum of % plans', v_max_plans
      using errcode = 'check_violation';
  end if;

  v_end := now() + make_interval(days => v_pay.period_days);
  insert into public.user_subscriptions
    (user_id, tier_id, status, current_period_end, grace_ends_at, amount_minor)
  values
    (v_pay.user_id, v_pay.tier_id, 'active', v_end, v_end + make_interval(days => v_grace),
     v_worth)
  returning * into v_sub;

  begin
    perform public.pay_referral_purchase_commission(p_payment_id);
  exception when others then
    insert into public.system_alerts (severity, code, message, context)
    values ('warning', 'referral_commission_failed',
            'A subscription was confirmed but its referral commission could not be paid.',
            jsonb_build_object('payment_id', p_payment_id, 'error', sqlerrm, 'sqlstate', sqlstate));
  end;

  return v_sub;
end;
$$;


-- ---------------------------------------------------------------------------
-- The affiliate checkout
-- ---------------------------------------------------------------------------

drop function if exists public.start_product_order(uuid, uuid, public.order_payment_method);

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
  v_product public.products;
  v_profile public.profiles;
  v_amount  bigint;
  v_charge  bigint;
  v_take    record;
  v_coupon   uuid;
  v_discount bigint := 0;
  v_row     public.orders;
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


-- ---------------------------------------------------------------------------
-- Commission is worked out before the coupon
-- ---------------------------------------------------------------------------

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

  if v_order.kind = 'training_renewal' then
    return null;
  end if;

  select * into v_program from public.affiliate_programs
   where product_id = v_order.product_id and status = 'active';
  if not found then
    return null;
  end if;

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

  select * into v_buyer from public.affiliate_accounts where user_id = v_order.user_id;
  if found and v_buyer.id = v_click.affiliate_id then
    return null;
  end if;

  select * into v_parent from public.affiliate_accounts
   where id = (select parent_affiliate_id from public.affiliate_accounts where id = v_click.affiliate_id);

  if found and v_parent.id is not null and v_parent.id <> v_click.affiliate_id then
    v_l2_depth := public.affiliate_depth_now(v_parent.id);
    if v_l2_depth >= 2 then
      v_l2_id := v_parent.id;
      v_l2_rate := v_program.l2_rate_value;
      select id into v_l2_ent from public.affiliate_entitlements
       where affiliate_id = v_parent.id and status = 'active' and grace_ends_at > now()
       order by commission_depth desc, expires_at desc limit 1;
    end if;
  end if;

  /* ⚠️ THE COUPON IS ADDED BACK, AND ONLY THE COUPON (operator, 2026-08-11).
     An affiliate's commission must not shrink because the platform ran a
     promotion, so the base is what the buyer would have paid without their
     code. A product's own SALE price is not added back: that is the seller's
     price, not a promotion by us, and reversing it would pay commission on a
     catalogue figure nobody was ever charged. With no coupon on the order this
     is `amount_minor`, exactly as before. */
  select v_order.amount_minor + coalesce(sum(r.discount_minor), 0)
    into v_base
    from public.coupon_redemptions r
   where r.order_id = v_order.id;

  insert into public.conversions
    (order_id, affiliate_id, click_id, subid, program_id,
     l1_rate, l2_affiliate_id, l2_rate, l2_entitlement_id, l2_depth_at_conversion,
     base_minor)
  values
    (p_order_id, v_click.affiliate_id, v_click.id, v_click.subid, v_program.id,
     v_program.l1_rate_value, v_l2_id, v_l2_rate, v_l2_ent, v_l2_depth,
     v_base)
  returning * into v_conversion;

  return v_conversion;
end;
$$;
