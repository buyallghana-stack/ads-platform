-- ============================================================================
-- Migration 110 — PHASE 2, step 3b of 7: the money path for orders
--
-- Gate G4, approved by the Owner on 2026-08-05 against the plan presented with
-- migration 109. Three functions: start an order, confirm it, refund it.
--
-- ⚠️ ONE THING IS DELIBERATELY INCOMPLETE AND MUST BE FINISHED IN STEP 4.
-- `confirm_product_order` grants a PERMANENT entitlement for every product,
-- including training. Training is valid one year from purchase (B11a) and the
-- `validity_days` that decides it lives on `training_programs`, which does not
-- exist until step 4. A function body cannot reference a table that is not
-- there yet, so step 4 must `create or replace` this function to stamp
-- `expires_at` on training grants. Until it does, a training purchase grants
-- access that never lapses.
--
-- Commission is NOT touched here. That is step 6, and it will hook into
-- `confirm_product_order` the same way Phase 1's referral commission hooks
-- into `confirm_subscription_payment` — one place where a purchase becomes
-- real, so no app-side payment code has to change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Starting an order
-- ---------------------------------------------------------------------------
--
-- The price is read from `product_price_minor()` HERE, on the server, and
-- never taken from the caller. A client-supplied price is a client-supplied
-- discount, and a sale that ended yesterday would still be honoured by
-- whoever kept the page open.
--
-- Only `purchase` is reachable today. Renewals and upgrades need the training
-- tables and arrive in step 4, with their own entry point — deliberately NOT
-- this one, because a renewal must never create a conversion (B11c) and the
-- surest way to guarantee that is for it not to share the code path.

create or replace function public.start_product_order(
  p_user_id uuid,
  p_product_id uuid,
  p_method public.order_payment_method
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

  v_amount := public.product_price_minor(p_product_id);

  insert into public.orders
    (user_id, product_id, kind, amount_minor, list_price_minor, method, status)
  values
    (p_user_id, p_product_id, 'purchase', v_amount, v_product.price_minor, p_method, 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.start_product_order(uuid, uuid, public.order_payment_method)
  from public, anon, authenticated;
grant execute on function public.start_product_order(uuid, uuid, public.order_payment_method)
  to service_role;


-- ---------------------------------------------------------------------------
-- 2. Granting what was bought
-- ---------------------------------------------------------------------------
--
-- Split out of `confirm` so the bundle rule lives in exactly one place.
--
-- A BUNDLE IS ONE COMMISSION BUT MANY ENTITLEMENTS (decided 2026-08-05). The
-- commission is a percentage of the bundle's own price at the bundle's own
-- rate; the ACCESS granted is a row for each product inside it, or the buyer
-- owns a bundle and can open nothing.
--
-- Every grant is an upsert, so re-running this — which a retried webhook will
-- do — cannot produce a second row or a second grant. It also revives an
-- entitlement previously revoked by a refund, which is correct: somebody who
-- refunds and later buys again should get their access back.

create or replace function public.grant_order_entitlements(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.orders;
  v_product public.products;
  v_granted int := 0;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Unknown order' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products where id = v_order.product_id;

  -- The product itself, bundle or not: owning the bundle is what "My Learning"
  -- lists, and what a refund revokes.
  insert into public.entitlements (user_id, product_id, order_id, status)
  values (v_order.user_id, v_order.product_id, v_order.id, 'active')
  on conflict (user_id, product_id) do update
    set order_id   = excluded.order_id,
        status     = 'active',
        expires_at = null,
        updated_at = now();
  v_granted := v_granted + 1;

  if v_product.kind = 'bundle' then
    insert into public.entitlements (user_id, product_id, order_id, status)
    select v_order.user_id, bi.product_id, v_order.id, 'active'
      from public.bundle_items bi
     where bi.bundle_product_id = v_order.product_id
    on conflict (user_id, product_id) do update
      set order_id   = excluded.order_id,
          status     = 'active',
          expires_at = null,
          updated_at = now();

    select v_granted + count(*)::int into v_granted
      from public.bundle_items bi where bi.bundle_product_id = v_order.product_id;
  end if;

  return v_granted;
end;
$$;

revoke execute on function public.grant_order_entitlements(uuid) from public, anon, authenticated;
grant execute on function public.grant_order_entitlements(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 3. Confirming a payment
-- ---------------------------------------------------------------------------

create or replace function public.confirm_product_order(
  p_order_id uuid,
  p_provider_ref text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  /* Locked, because a Paystack webhook and the browser callback can arrive at
     the same instant. Without the lock both read `pending`, both confirm, and
     the entitlement is granted twice — harmless today because the grant
     upserts, and not harmless at all once step 6 pays commission off the back
     of it. */
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Unknown order' using errcode = 'check_violation';
  end if;

  /* IDEMPOTENT ON THE SAME REFERENCE. A retried delivery of the same webhook
     is not an error and must not look like one — Phase 1 files unexplained
     faults in Sentry, and an expected retry raising there is how a real
     failure gets lost in the noise. */
  if v_order.status = 'confirmed' then
    if v_order.provider_ref is not distinct from p_provider_ref then
      return v_order;
    end if;
    raise exception 'That order was already confirmed with another reference'
      using errcode = 'check_violation';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'That order is % and cannot be confirmed', v_order.status
      using errcode = 'check_violation';
  end if;

  update public.orders
     set status       = 'confirmed',
         provider_ref = p_provider_ref,
         confirmed_at = now()
   where id = p_order_id
  returning * into v_order;

  /*
    THE GRANT MUST NEVER FAIL THE PAYMENT.

    The money has arrived. Rolling the order back because an entitlement row
    would not write leaves somebody charged for nothing, which is far worse
    than an order that is paid but not yet unlocked — the second is fixable by
    an admin in one click, the first is a refund and a complaint. So the grant
    runs in its own block and a failure raises an alert instead.

    Same shape as Phase 1's referral commission, which is deliberately not
    allowed to roll back a plan somebody paid for.
  */
  begin
    perform public.grant_order_entitlements(p_order_id);
  exception when others then
    insert into public.system_alerts (severity, code, message, context)
    values (
      'high', 'entitlement_grant_failed',
      'An order was paid but its access could not be granted.',
      jsonb_build_object('order_id', p_order_id, 'error', sqlerrm)
    );
  end;

  return v_order;
end;
$$;

revoke execute on function public.confirm_product_order(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_product_order(uuid, text) to service_role;


-- ---------------------------------------------------------------------------
-- 4. Refunding
-- ---------------------------------------------------------------------------
--
-- Owner, 2026-08-05: access is revoked IMMEDIATELY on refund. They have their
-- money back, so they no longer have the product. A grace period would make
-- "refund then binge" a free rental.
--
-- ⚠️ REVOKED BY ORDER, NOT BY PRODUCT, and the difference is deliberate.
-- `entitlements.order_id` is the order that most recently granted or extended
-- the row. If somebody bought a course outright and later got it again inside
-- a bundle, the row points at the bundle — so refunding the standalone
-- purchase revokes nothing, which is correct: they still own it through the
-- bundle they did not refund. Revoking by product would take away access they
-- have paid for twice and kept once.

create or replace function public.refund_product_order(
  p_order_id uuid,
  p_admin_id uuid,
  p_reason text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.orders;
  v_revoked int;
  v_email   text;
begin
  perform public.assert_admin(p_admin_id);

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A refund needs a reason' using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Unknown order' using errcode = 'check_violation';
  end if;

  if v_order.status = 'refunded' then
    return v_order;   -- idempotent; refunding twice is not an error
  end if;

  if v_order.status <> 'confirmed' then
    raise exception 'Only a confirmed order can be refunded' using errcode = 'check_violation';
  end if;

  update public.orders
     set status = 'refunded', refunded_at = now()
   where id = p_order_id
  returning * into v_order;

  update public.entitlements
     set status = 'revoked', updated_at = now()
   where order_id = p_order_id;
  get diagnostics v_revoked = row_count;

  select u.email::text into v_email from auth.users u where u.id = p_admin_id;

  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, old_values, new_values)
  values (
    p_admin_id, v_email, 'refund_order', 'orders', p_order_id,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object(
      'status', 'refunded',
      'reason', p_reason,
      'amount_minor', v_order.amount_minor,
      'entitlements_revoked', v_revoked
    )
  );

  return v_order;
end;
$$;

revoke execute on function public.refund_product_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.refund_product_order(uuid, uuid, text) to service_role;
