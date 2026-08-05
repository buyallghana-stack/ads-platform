-- ============================================================================
-- Migration 115 — PHASE 2, step 6b of 7: the commission money path
--
-- Gate G4, approved by the Owner on 2026-08-06 against the plan presented with
-- migration 114, including the rounding rule: round level one, then compute
-- level two from what is LEFT of the sale.
--
-- Four functions: pay, clear, reverse, reconcile.
--
-- ---------------------------------------------------------------------------
-- THE ROUNDING RULE, AND WHY IT IS NOT SYMMETRIC
--
-- Rounding each level independently against the base lets the two add up to a
-- pesewa MORE than the percentages allow — 30% and 10% of 12,345 rounds to
-- 3,704 + 1,235 = 4,939, where 40% of the base is 4,938. One pesewa is
-- nothing; a commission pair that can exceed its own configured share is a
-- property nobody wants to have to reason about later.
--
-- So level two is a percentage of the REMAINDER after level one is taken:
--
--   l1 = round(base × l1_rate / 100)
--   l2 = round((base − l1) × l2_rate / 100)
--
-- The pair can then never exceed the base, whatever the rates are, and the
-- guarantee holds by construction rather than by a clamp. It is also exactly
-- what the "level two is paid out of the remainder" decision already meant —
-- Phase 1's two-level referral commission works the same way.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Paying a conversion
-- ---------------------------------------------------------------------------

create or replace function public.pay_conversion_commissions(p_conversion_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv    public.conversions;
  v_program public.affiliate_programs;
  v_l1      bigint;
  v_l2      bigint;
  v_status  public.commission_status;
  v_clears  timestamptz;
  v_written int := 0;
begin
  select * into v_conv from public.conversions where id = p_conversion_id;
  if not found then
    raise exception 'Unknown conversion' using errcode = 'check_violation';
  end if;

  if v_conv.status <> 'attributed' then
    return 0;   -- reversed conversions do not pay
  end if;

  select * into v_program from public.affiliate_programs where id = v_conv.program_id;
  if not found then
    return 0;
  end if;

  /* C19: with a zero hold a commission is spendable the moment it is earned.
     The pending state still exists so the Owner can turn a hold on without a
     migration — see the note on the ledger table. */
  if v_program.hold_days > 0 then
    v_status := 'pending';
    v_clears := now() + make_interval(days => v_program.hold_days);
  else
    v_status := 'cleared';
    v_clears := null;
  end if;

  v_l1 := round(v_conv.base_minor * v_conv.l1_rate / 100.0);

  if v_l1 > 0 then
    /* The idempotency key names what it is paying for, so two different
       callers computing it arrive at the same string. The partial unique index
       on (conversion_id, level) is the second guard behind it. */
    insert into public.commission_ledger
      (affiliate_id, conversion_id, level, entry_type, amount_minor, status, clears_at,
       idempotency_key)
    values
      (v_conv.affiliate_id, v_conv.id, 1, 'credit', v_l1, v_status, v_clears,
       'conversion:' || v_conv.id::text || ':level:1')
    on conflict (idempotency_key) do nothing;
    v_written := v_written + 1;
  end if;

  /* Level two, out of the remainder, and only for an upline who held
     Professional AT THE MOMENT OF THE SALE (C22). That was resolved and
     written onto the conversion by `attribute_order`; it is read here rather
     than asked again, because by now it may have changed. */
  if v_conv.l2_affiliate_id is not null
     and v_conv.l2_rate is not null
     and coalesce(v_conv.l2_depth_at_conversion, 0) >= 2 then

    v_l2 := round((v_conv.base_minor - v_l1) * v_conv.l2_rate / 100.0);

    if v_l2 > 0 then
      insert into public.commission_ledger
        (affiliate_id, conversion_id, level, entry_type, amount_minor, status, clears_at,
         idempotency_key)
      values
        (v_conv.l2_affiliate_id, v_conv.id, 2, 'credit', v_l2, v_status, v_clears,
         'conversion:' || v_conv.id::text || ':level:2')
      on conflict (idempotency_key) do nothing;
      v_written := v_written + 1;
    end if;
  end if;

  return v_written;
end;
$$;

revoke execute on function public.pay_conversion_commissions(uuid) from public, anon, authenticated;
grant execute on function public.pay_conversion_commissions(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 2. Clearing what is due
-- ---------------------------------------------------------------------------
--
-- A no-op while the hold is zero, which is the point: the day the Owner sets a
-- hold, the mechanism is already built and already tested rather than being
-- written under time pressure because money is sitting in the wrong state.

create or replace function public.clear_due_commissions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_cleared int;
begin
  update public.commission_ledger
     set status = 'cleared', clears_at = null, updated_at = now()
   where status = 'pending'
     and clears_at is not null
     and clears_at <= now();
  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

revoke execute on function public.clear_due_commissions() from public, anon, authenticated;
grant execute on function public.clear_due_commissions() to service_role;


-- ---------------------------------------------------------------------------
-- 3. Reversing
-- ---------------------------------------------------------------------------
--
-- NEGATIVE ROWS, NOT EDITS. The credits stay exactly as they were written and
-- a reversal is added beside them, so the history reads as what happened
-- rather than as what is currently true. The ledger's own trigger refuses a
-- rewrite anyway; this is the shape that trigger exists to enforce.
--
-- BOTH LEVELS UNWIND. A refund that took back the seller's commission but left
-- the upline's override would pay somebody for a sale that did not happen —
-- the same claw-back property Phase 1 holds for its two-level referrals.

create or replace function public.reverse_conversion_commissions(
  p_conversion_id uuid,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry    public.commission_ledger;
  v_reversed int := 0;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reversal needs a reason' using errcode = 'check_violation';
  end if;

  for v_entry in
    select * from public.commission_ledger
     where conversion_id = p_conversion_id
       and entry_type = 'credit'
       and status <> 'reversed'
  loop
    insert into public.commission_ledger
      (affiliate_id, conversion_id, level, entry_type, amount_minor, status,
       reason, idempotency_key)
    values
      (v_entry.affiliate_id, v_entry.conversion_id, v_entry.level, 'reversal',
       -v_entry.amount_minor, 'cleared', p_reason,
       'reversal:' || v_entry.id::text)
    on conflict (idempotency_key) do nothing;

    /* The credit is marked so it is not reversed twice. Its AMOUNT is
       untouched — that is the immutable part. */
    update public.commission_ledger set status = 'reversed', updated_at = now()
     where id = v_entry.id;

    v_reversed := v_reversed + 1;
  end loop;

  update public.conversions set status = 'reversed' where id = p_conversion_id;

  return v_reversed;
end;
$$;

revoke execute on function public.reverse_conversion_commissions(uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_conversion_commissions(uuid, text) to service_role;


-- ---------------------------------------------------------------------------
-- 4. Refunding now unwinds the commission too
-- ---------------------------------------------------------------------------
--
-- Replaces migration 110's version. The refund itself is unchanged; what is
-- added is the reversal of whatever the sale paid out.
--
-- ⚠️ C21: a reversal after a payout can drive a balance NEGATIVE, and that is
-- allowed on purpose — the Owner chose "block future payouts until the balance
-- is clear" over writing the loss off automatically. So
-- `affiliate_balance_minor` may return a negative number, and the payout
-- request path in step 7 must check for it rather than assume it cannot happen.

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
  v_order      public.orders;
  v_conversion public.conversions;
  v_revoked    int;
  v_reversed   int := 0;
  v_email      text;
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
    return v_order;
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

  select * into v_conversion from public.conversions where order_id = p_order_id;
  if found then
    v_reversed := public.reverse_conversion_commissions(
      v_conversion.id, 'Order refunded: ' || p_reason);
  end if;

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
      'entitlements_revoked', v_revoked,
      'commissions_reversed', v_reversed
    )
  );

  return v_order;
end;
$$;

revoke execute on function public.refund_product_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.refund_product_order(uuid, uuid, text) to service_role;


-- ---------------------------------------------------------------------------
-- 5. Confirming now pays the commission
-- ---------------------------------------------------------------------------
--
-- Replaces migration 112's version. One line is added — the commission call,
-- immediately after attribution, inside the same exception block that already
-- protects the payment.
--
-- Hooked HERE rather than in application code for the reason Phase 1 gives for
-- its referral commission: this is the single place a purchase becomes real,
-- so both the Paystack webhook and the browser callback are covered without
-- either of them knowing commissions exist.

create or replace function public.confirm_product_order(
  p_order_id uuid,
  p_provider_ref text,
  p_visitor_token text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order      public.orders;
  v_product    public.products;
  v_training   public.training_programs;
  v_account    public.affiliate_accounts;
  v_conversion public.conversions;
  v_parent     uuid;
  v_expires    timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Unknown order' using errcode = 'check_violation';
  end if;

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
     set status = 'confirmed', provider_ref = p_provider_ref, confirmed_at = now()
   where id = p_order_id
  returning * into v_order;

  begin
    perform public.grant_order_entitlements(p_order_id);

    v_conversion := public.attribute_order(p_order_id, p_visitor_token);
    if v_conversion.id is not null then
      perform public.pay_conversion_commissions(v_conversion.id);
    end if;

    select * into v_product from public.products where id = v_order.product_id;

    if v_product.purpose = 'training_program' and v_order.kind = 'purchase' then
      select * into v_training from public.training_programs where product_id = v_product.id;

      if found then
        select * into v_account from public.affiliate_accounts where user_id = v_order.user_id;

        if not found then
          v_parent := case
                        when v_conversion.id is not null then v_conversion.affiliate_id
                        else null
                      end;

          insert into public.affiliate_accounts (user_id, affiliate_code, status, parent_affiliate_id)
          values (v_order.user_id, public.generate_affiliate_code(), 'pending', v_parent)
          returning * into v_account;
        end if;

        v_expires := v_order.confirmed_at + make_interval(days => v_training.validity_days);

        insert into public.affiliate_entitlements
          (affiliate_id, training_program_id, order_id, commission_depth,
           starts_at, expires_at, grace_ends_at, status)
        values
          (v_account.id, v_training.id, v_order.id, v_training.commission_depth,
           v_order.confirmed_at, v_expires,
           v_expires + make_interval(days => v_training.grace_days), 'active')
        on conflict (affiliate_id, training_program_id) do update
          set order_id         = excluded.order_id,
              commission_depth = excluded.commission_depth,
              expires_at       = greatest(public.affiliate_entitlements.expires_at, excluded.expires_at),
              grace_ends_at    = greatest(public.affiliate_entitlements.grace_ends_at, excluded.grace_ends_at),
              status           = 'active',
              updated_at       = now();

        perform public.evaluate_affiliate_activation(v_order.user_id, v_product.id);
      end if;
    end if;
  exception when others then
    insert into public.system_alerts (severity, code, message, context)
    values (
      'high', 'entitlement_grant_failed',
      'An order was paid but its access or commission could not be granted.',
      jsonb_build_object('order_id', p_order_id, 'error', sqlerrm)
    );
  end;

  return v_order;
end;
$$;

revoke execute on function public.confirm_product_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_product_order(uuid, text, text) to service_role;


-- ---------------------------------------------------------------------------
-- 6. Proving the ledger adds up
-- ---------------------------------------------------------------------------
--
-- Returns discrepancies rather than raising, so it can be run as a health
-- check on a schedule and read as a report. An empty result is the pass.

create or replace function public.reconcile_commission_ledger()
returns table (
  affiliate_id uuid,
  problem      text,
  detail       jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  -- A credit whose conversion has been reversed but which was never reversed
  -- itself: money still standing against a sale that was undone.
  select l.affiliate_id,
         'credit stands against a reversed conversion' as problem,
         jsonb_build_object('ledger_id', l.id, 'conversion_id', l.conversion_id,
                            'amount_minor', l.amount_minor) as detail
    from public.commission_ledger l
    join public.conversions c on c.id = l.conversion_id
   where l.entry_type = 'credit'
     and l.status <> 'reversed'
     and c.status = 'reversed'

  union all

  -- A reversal with no matching credit.
  select l.affiliate_id,
         'reversal with no credit behind it',
         jsonb_build_object('ledger_id', l.id, 'conversion_id', l.conversion_id)
    from public.commission_ledger l
   where l.entry_type = 'reversal'
     and not exists (
       select 1 from public.commission_ledger c
        where c.conversion_id = l.conversion_id
          and c.level = l.level
          and c.entry_type = 'credit'
     )

  union all

  -- A credit that pays more than the sale it came from.
  select l.affiliate_id,
         'credit exceeds the sale it came from',
         jsonb_build_object('ledger_id', l.id, 'amount_minor', l.amount_minor,
                            'base_minor', c.base_minor)
    from public.commission_ledger l
    join public.conversions c on c.id = l.conversion_id
   where l.entry_type = 'credit'
     and l.amount_minor > c.base_minor

  union all

  -- Both levels of one conversion adding up to more than the sale.
  select c.affiliate_id,
         'both levels together exceed the sale',
         jsonb_build_object('conversion_id', c.id, 'base_minor', c.base_minor,
                            'paid_minor', sum(l.amount_minor))
    from public.conversions c
    join public.commission_ledger l
      on l.conversion_id = c.id and l.entry_type = 'credit'
   group by c.id, c.affiliate_id, c.base_minor
  having sum(l.amount_minor) > c.base_minor;
$$;

comment on function public.reconcile_commission_ledger() is
  'Health check. An empty result is the pass. Returns discrepancies rather than raising so it can be scheduled and read as a report.';

revoke execute on function public.reconcile_commission_ledger() from public, anon, authenticated;
grant execute on function public.reconcile_commission_ledger() to service_role;
