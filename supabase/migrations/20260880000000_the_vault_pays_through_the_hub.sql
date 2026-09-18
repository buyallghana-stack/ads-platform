-- ============================================================================
-- Migration 232 - the Vault pays through the hub
--
-- WHY. Plans moved onto the Tech Store payment hub on 16 September 2026 and the
-- Vault was left behind. It still called `api.paystack.co` from this app, with
-- this app's own key, handing Paystack a `sideperks.org/vault/callback` URL and
-- metadata naming a vault plan. The one rule the hub exists to keep is that
-- NOTHING SENT TO PAYSTACK MAY REVEAL SIDEPERKS, and that path broke it every
-- time it ran.
--
-- It was survivable while the shared Paystack account was in test mode. The
-- live keys went in on 17 September 2026, so it is not survivable any more.
--
-- The Vault now opens a `vault_payments` row, sends its id to the hub as
-- `external_ref` exactly as a plan does, and is settled by the same
-- `applyHubEvent`. That function needs three things a Vault payment has never
-- had, because until now nothing but a browser redirect ever settled one:
--
--   attach_vault_hub_reference   store the hub's reference before the buyer
--                                leaves, or a paid deposit cannot be matched
--   fail_vault_payment           close an attempt the hub reports as failed or
--                                abandoned
--   reverse_vault_payment        give back a deposit the provider reversed,
--                                and take back what it paid out
--
-- and one change to `confirm_vault_payment`, so it agrees with its subscription
-- counterpart about which statuses may still be confirmed (migration 230).
--
-- ⚠️ TWO CHECK CONSTRAINTS HAVE TO WIDEN FIRST. `vault_payments.status` allowed
-- only pending, confirmed and failed, and `vault_investments.status` only
-- active and claimed. A reversal needs `refunded` and `cancelled`, and adding
-- the functions without the constraints would leave a reversal raising inside a
-- transaction that has already given the money back on the other side.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Room for a reversal
-- ---------------------------------------------------------------------------

alter table public.vault_payments
  drop constraint if exists vault_payments_status_check;

alter table public.vault_payments
  add constraint vault_payments_status_check
  check (status in ('pending', 'confirmed', 'failed', 'refunded'));

alter table public.vault_investments
  drop constraint if exists vault_investments_status_check;

alter table public.vault_investments
  add constraint vault_investments_status_check
  check (status in ('active', 'claimed', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 2. attach_vault_hub_reference
-- ---------------------------------------------------------------------------
--
-- The hub's reference is the only thing the return page and the confirm
-- endpoint carry, so it is stored before the buyer leaves for Paystack. A
-- deposit whose reference was lost here is a deposit that was paid for and
-- cannot be matched to anybody.
--
-- Deliberately a copy of `attach_hub_reference` rather than a generalisation of
-- it. One function that took a table name would be one function that could be
-- pointed at the wrong table, and these two are called from code that already
-- knows which kind of payment it is holding.

create or replace function public.attach_vault_hub_reference(
  p_payment_id uuid,
  p_reference  text
)
returns public.vault_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.vault_payments;
begin
  select * into v_pay from public.vault_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Vault payment not found' using errcode = 'check_violation';
  end if;

  /* Asking the hub twice for the same order is normal: it answers with the
     payment already running and returns the SAME reference. Re-attaching it is
     a no-op, not a conflict, or a reloaded checkout page becomes an error. */
  if v_pay.external_reference is not null then
    if v_pay.external_reference = p_reference then
      return v_pay;
    end if;
    raise exception 'That vault payment already has a different reference'
      using errcode = 'check_violation';
  end if;

  if v_pay.status <> 'pending' then
    raise exception 'Vault payment is % and is no longer waiting for a reference', v_pay.status
      using errcode = 'check_violation';
  end if;

  update public.vault_payments
     set external_reference = p_reference
   where id = p_payment_id
  returning * into v_pay;

  return v_pay;
end;
$$;

revoke execute on function public.attach_vault_hub_reference(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.attach_vault_hub_reference(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. fail_vault_payment
-- ---------------------------------------------------------------------------
--
-- Closes an attempt that did not complete. Idempotent, and it never walks back
-- a confirmation: `failed`, `confirmed` and `refunded` all return unchanged, so
-- a duplicate delivery and a late sweep reach the same answer.

create or replace function public.fail_vault_payment(
  p_payment_id uuid,
  p_reason     text default null
)
returns public.vault_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.vault_payments;
begin
  select * into v_pay from public.vault_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Vault payment not found' using errcode = 'check_violation';
  end if;

  if v_pay.status in ('failed', 'confirmed', 'refunded') then
    return v_pay;
  end if;

  update public.vault_payments
     set status = 'failed',
         failure_reason = coalesce(p_reason, 'Payment did not complete')
   where id = p_payment_id
  returning * into v_pay;

  return v_pay;
end;
$$;

revoke execute on function public.fail_vault_payment(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.fail_vault_payment(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. confirm_vault_payment, brought in line with migration 230
-- ---------------------------------------------------------------------------
--
-- The body is migration 209's, with the status rules the subscription side
-- learned on 17 September:
--
--   * `refunded` now RAISES. Money that was given back must not become a live
--     investment on the strength of a late event.
--   * `failed` may be confirmed, because three things close a payment here
--     without Paystack ever being asked: the sweep, the hub answering `failed`
--     and the hub answering `abandoned`. A genuine success arriving afterwards
--     used to be impossible to accept, and the hub would have retried a 500 for
--     24 hours and then given up on a buyer who had paid.
--   * `confirmed` is still the idempotent no-op it always was.
--
-- The amount is checked before this is ever reached, in `applyHubEvent`, so a
-- late success at the wrong figure is flagged for an admin rather than granted.

create or replace function public.confirm_vault_payment(
  p_payment_id uuid,
  p_reference  text,
  p_payload    jsonb default '{}'::jsonb
)
returns public.vault_investments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay           public.vault_payments;
  v_plan          public.vault_plans;
  v_inv           public.vault_investments;
  v_profit_minor  bigint;
  v_return_minor  bigint;
  v_ends_at       timestamptz;
  v_was_closed    boolean;
begin
  select * into v_pay
    from public.vault_payments
   where id = p_payment_id
     for update;

  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  if v_pay.status = 'confirmed' then
    select * into v_inv from public.vault_investments where payment_id = v_pay.id;
    return v_inv;
  end if;

  if v_pay.status = 'refunded' then
    raise exception 'Vault payment was refunded and cannot be confirmed'
      using errcode = 'check_violation';
  end if;

  v_was_closed := v_pay.status = 'failed';

  select * into v_plan from public.vault_plans where id = v_pay.plan_id;
  if not found then
    raise exception 'Associated vault plan not found' using errcode = 'check_violation';
  end if;

  v_ends_at := now() + make_interval(days => v_plan.period_days);
  v_profit_minor := round(v_pay.amount_minor * (v_plan.daily_return_percent / 100.0) * v_plan.period_days);
  v_return_minor := v_pay.amount_minor + v_profit_minor;

  -- 1. Mark payment confirmed. The failure reason goes with it: a row cannot
  --    both hold an investment and explain why it did not.
  update public.vault_payments
     set status = 'confirmed',
         external_reference = coalesce(p_reference, external_reference),
         provider_payload = coalesce(p_payload, provider_payload),
         failure_reason = null,
         confirmed_at = now()
   where id = v_pay.id;

  -- 2. Create investment
  insert into public.vault_investments (
    user_id, plan_id, plan_name, amount_minor, currency_code,
    daily_return_percent, period_days, started_at, ends_at,
    status, expected_profit_minor, expected_return_minor, payment_id
  )
  values (
    v_pay.user_id, v_plan.id, v_plan.name, v_pay.amount_minor, v_pay.currency_code,
    v_plan.daily_return_percent, v_plan.period_days, now(), v_ends_at,
    'active', v_profit_minor, v_return_minor, v_pay.id
  )
  returning * into v_inv;

  -- 3. Notify user
  perform public.create_notification(
    v_pay.user_id,
    'vault'::public.notification_type,
    'Vault Plan Activated',
    format('Your deposit of GHS %s in %s has started. It will mature on %s.',
           to_char(v_pay.amount_minor::numeric / 100.0, 'FM999,999,990.00'),
           v_plan.name,
           to_char(v_ends_at, 'YYYY-MM-DD')),
    jsonb_build_object('investment_id', v_inv.id, 'plan_id', v_plan.id)
  );

  -- 4. A rare event and a loud one: the buyer was told this did not work.
  if v_was_closed then
    insert into public.system_alerts (severity, code, message, context)
    values ('warning', 'late_payment_confirmed',
            'A vault payment that had been closed as failed was confirmed by the payment hub.',
            jsonb_build_object(
              'payment_id', p_payment_id,
              'reference', p_reference,
              'user_id', v_pay.user_id,
              'kind', 'vault',
              'was_failed_because', v_pay.failure_reason,
              'payload', coalesce(p_payload, '{}'::jsonb)));
  end if;

  return v_inv;
end;
$$;

revoke execute on function public.confirm_vault_payment(uuid, text, jsonb)
  from public, anon, authenticated;
grant  execute on function public.confirm_vault_payment(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. reverse_vault_payment
-- ---------------------------------------------------------------------------
--
-- What a `payment.reversed` from the hub does to a deposit.
--
-- ⚠️ THE CLAWBACK IS THE HARD HALF, and it is not symmetrical with the
-- subscription one. A plan is a thing we stop providing. A matured vault has
-- already PAID POINTS OUT, and those points may have been spent or withdrawn by
-- the time the reversal arrives.
--
-- So the rule is the one the referral clawback already uses: take back what is
-- there, never push a balance negative, and raise an alert naming the
-- shortfall. A user cannot be turned into a debtor by a refund they may not
-- have asked for, and an operator cannot act on money the platform is out
-- unless somebody tells them.
--
-- An investment that has NOT been claimed is simply cancelled. Nothing was paid
-- out, so nothing is recovered, and `cancelled` is a third status rather than a
-- deletion because the row is the record that this happened.

create or replace function public.reverse_vault_payment(
  p_payment_id uuid,
  p_reason     text default null
)
returns public.vault_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay       public.vault_payments;
  v_inv       public.vault_investments;
  v_owed      bigint := 0;
  v_recovered bigint := 0;
  v_balance   bigint;
begin
  select * into v_pay from public.vault_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Vault payment not found' using errcode = 'check_violation';
  end if;

  -- Idempotent: the hub may retry, and the sweep may reach the same answer.
  if v_pay.status = 'refunded' then
    return v_pay;
  end if;

  /* A payment that never confirmed has nothing to reverse. Close it and stop,
     rather than raising: a reversal for an unconfirmed payment is odd but not a
     reason to make the hub retry for 24 hours. */
  if v_pay.status <> 'confirmed' then
    return public.fail_vault_payment(p_payment_id, coalesce(p_reason, 'Reversed before confirmation'));
  end if;

  update public.vault_payments
     set status = 'refunded',
         failure_reason = coalesce(p_reason, 'Payment reversed')
   where id = p_payment_id
  returning * into v_pay;

  select * into v_inv
    from public.vault_investments
   where payment_id = p_payment_id
     for update;

  if found and v_inv.status <> 'cancelled' then
    if v_inv.status = 'claimed' then
      v_owed := coalesce(v_inv.claimed_points, 0);

      select coalesce(balance, 0) into v_balance
        from public.user_balances where user_id = v_inv.user_id;

      v_recovered := least(v_owed, coalesce(v_balance, 0));

      if v_recovered > 0 then
        perform public.debit_points(
          v_inv.user_id, v_recovered, 'admin_adjustment', 'vault_reversal', v_inv.id::text,
          jsonb_build_object(
            'payment_id', p_payment_id,
            'investment_id', v_inv.id,
            'plan_name', v_inv.plan_name,
            'owed', v_owed,
            'recovered', v_recovered,
            'reason', coalesce(p_reason, 'Payment reversed')));
      end if;
    end if;

    update public.vault_investments
       set status = 'cancelled',
           updated_at = now()
     where id = v_inv.id;
  end if;

  if v_owed > v_recovered then
    insert into public.system_alerts (severity, code, message, context)
    values ('warning', 'vault_clawback_short',
            'A vault deposit was reversed but its payout could not be fully recovered.',
            jsonb_build_object(
              'payment_id', p_payment_id,
              'investment_id', v_inv.id,
              'user_id', v_pay.user_id,
              'owed_points', v_owed,
              'recovered_points', v_recovered));
  end if;

  return v_pay;
end;
$$;

revoke execute on function public.reverse_vault_payment(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.reverse_vault_payment(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. hub_inbound_events can name a vault payment
-- ---------------------------------------------------------------------------
--
-- ⚠️ `payment_id` carried a FOREIGN KEY to `subscription_payments`, so writing a
-- vault payment's id there fails. That matters more than it looks: the row is
-- written by `recordRefusal`, which is how a mismatch or test money becomes
-- visible to an administrator at all. A refusal that cannot be written is a
-- guard nobody can see.
--
-- A reference cannot point at two tables, so the constraint goes and a `kind`
-- takes its place. `on delete set null` went with it, which is a real loss and
-- a small one: these rows are an audit trail, and a dangling id on a deleted
-- payment reads as history rather than as corruption.

alter table public.hub_inbound_events
  drop constraint if exists hub_inbound_events_payment_id_fkey;

alter table public.hub_inbound_events
  add column if not exists payment_kind text not null default 'subscription';

alter table public.hub_inbound_events
  drop constraint if exists hub_inbound_events_payment_kind_check;

alter table public.hub_inbound_events
  add constraint hub_inbound_events_payment_kind_check
  check (payment_kind in ('subscription', 'vault'));

-- ---------------------------------------------------------------------------
-- 7. The flags screen shows which kind, and finds the buyer either way
-- ---------------------------------------------------------------------------
--
-- ⚠️ DROP AND CREATE, not `create or replace`: a function's OUT columns cannot
-- be changed in place, and `create or replace` would raise rather than widen.
-- Dropping hands EXECUTE back to PUBLIC, so the grants below are not a
-- formality. That is how seventeen functions once became readable with the anon
-- key.
--
-- `admin_list_hub_payments` is deliberately left alone. It lists subscription
-- payments, vault deposits have their own admin screen, and a union would have
-- to cast an enum status to text and change that screen's types for a listing
-- rather than for a safety net. The safety net is this function.

drop function if exists public.admin_list_hub_flags(integer);

create function public.admin_list_hub_flags(p_limit integer default 100)
returns table (
  id            uuid,
  request_id    uuid,
  event         text,
  hub_reference text,
  amount_minor  bigint,
  currency_code character(3),
  result        text,
  detail        text,
  received_at   timestamptz,
  payment_id    uuid,
  payment_kind  text,
  person        text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    e.id, e.request_id, e.event, e.hub_reference, e.amount_minor, e.currency_code,
    e.result, e.detail, e.received_at, e.payment_id, e.payment_kind,
    coalesce(pr_sub.full_name, pr_vault.full_name)
  from public.hub_inbound_events e
  left join public.subscription_payments sp
         on sp.id = e.payment_id and e.payment_kind = 'subscription'
  left join public.profiles pr_sub on pr_sub.id = sp.user_id
  left join public.vault_payments vp
         on vp.id = e.payment_id and e.payment_kind = 'vault'
  left join public.profiles pr_vault on pr_vault.id = vp.user_id
  where e.result not in ('confirmed', 'failed', 'reversed', 'already_done')
  order by e.received_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;

revoke execute on function public.admin_list_hub_flags(integer) from public, anon;
grant  execute on function public.admin_list_hub_flags(integer) to authenticated, service_role;
