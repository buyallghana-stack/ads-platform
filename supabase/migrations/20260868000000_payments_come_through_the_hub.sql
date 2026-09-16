-- ============================================================================
-- Migration 220 — Part B foundations: this app buys through the Tech Store hub
--
-- The design note is docs/payment-hub-contract.md. The short version: the Tech
-- Store owns the only Paystack account, so this app never calls Paystack. It
-- asks the hub to start a payment, the hub takes Paystack's webhook, and the
-- hub posts the result back here over a signed channel.
--
-- WHAT THIS MIGRATION DOES NOT DO, deliberately: it does not invent a
-- `payment_orders` table. The brief asked for one, and this repository already
-- has it under a different name. `subscription_payments` is a row per attempt,
-- its id is already what gets sent to the payment provider as the reference,
-- and `confirm_subscription_payment` is already the idempotent fulfilment that
-- grants the plan and pays the referral commission. A second table beside it
-- would be a second answer to "what did this person buy", and the last time
-- this codebase had one rule in several places it cost real money. So the hub
-- reuses the money path that is already tested, and `external_reference`
-- carries the hub reference exactly as it used to carry the Paystack one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The hub reference has to be stored BEFORE the user pays, not after.
--
-- `confirm_subscription_payment` sets `external_reference` when the money
-- lands. That is too late for the hub: the return page comes back carrying
-- only the reference, and the reconciliation sweep has nothing else to ask
-- about. So the reference is attached at initialize time, and the unique index
-- is what stops two orders ever claiming the same one.
-- ----------------------------------------------------------------------------
create unique index if not exists subscription_payments_external_reference_key
  on public.subscription_payments (external_reference)
  where external_reference is not null;

create or replace function public.attach_hub_reference(
  p_payment_id uuid,
  p_reference  text
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pay public.subscription_payments;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  /* Asking the hub twice for the same order is normal: it answers with the
     payment already running rather than starting a second one, and it returns
     the SAME reference. Re-attaching it must therefore be a no-op, not a
     conflict, or a user who reloads the checkout page gets an error instead of
     the payment they already have. */
  if v_pay.external_reference is not null then
    if v_pay.external_reference = p_reference then
      return v_pay;
    end if;
    raise exception 'That payment already has a different reference'
      using errcode = 'check_violation';
  end if;

  if v_pay.status <> 'pending' then
    raise exception 'Payment is % and is no longer waiting for a reference', v_pay.status
      using errcode = 'check_violation';
  end if;

  update public.subscription_payments
     set external_reference = p_reference
   where id = p_payment_id
  returning * into v_pay;

  return v_pay;
end;
$function$;

revoke execute on function public.attach_hub_reference(uuid, text) from public, anon, authenticated;
grant  execute on function public.attach_hub_reference(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 2. What the hub told us, and what we did about it.
--
-- The hub promises never to send the same event twice, and the return page and
-- the confirm endpoint race each other by design, so this table is the second
-- belt: a request id may be recorded once. It is also the audit trail for the
-- money, which is the part an operator needs when somebody says they paid and
-- the plan is not there.
-- ----------------------------------------------------------------------------
create table if not exists public.hub_inbound_events (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid        not null unique,
  event        text        not null,
  hub_reference text       not null,
  payment_id   uuid        references public.subscription_payments (id) on delete set null,
  amount_minor bigint,
  currency_code char(3),
  payload      jsonb       not null default '{}'::jsonb,
  result       text        not null,
  detail       text,
  received_at  timestamptz not null default now()
);

create index if not exists hub_inbound_events_reference_idx
  on public.hub_inbound_events (hub_reference, received_at desc);
create index if not exists hub_inbound_events_result_idx
  on public.hub_inbound_events (result, received_at desc)
  where result <> 'fulfilled';

/* ⚠️ RLS on with NO policy is the point, not an oversight. This table records
   money events for every user; nothing holding a browser key may read it, and
   the admin screens reach it through the service role like the rest of the
   money surface. An "own rows" policy here would be wrong twice over, because
   these rows belong to a payment, not to a reader. */
alter table public.hub_inbound_events enable row level security;
revoke all on public.hub_inbound_events from anon, authenticated;
grant  all on public.hub_inbound_events to service_role;

-- ----------------------------------------------------------------------------
-- 3. A payment that never completed.
--
-- Separate from reversal because they are different facts: this one never took
-- any money, so there is nothing to give back and nothing to revoke.
-- ----------------------------------------------------------------------------
create or replace function public.fail_subscription_payment(
  p_payment_id uuid,
  p_reason     text default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pay public.subscription_payments;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  -- Idempotent, and never walks back a confirmation.
  if v_pay.status in ('failed', 'confirmed', 'refunded') then
    return v_pay;
  end if;

  update public.subscription_payments
     set status = 'failed',
         failure_reason = coalesce(p_reason, 'Payment did not complete')
   where id = p_payment_id
  returning * into v_pay;

  return v_pay;
end;
$function$;

revoke execute on function public.fail_subscription_payment(uuid, text) from public, anon, authenticated;
grant  execute on function public.fail_subscription_payment(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Reversal: the operator's decision, 16 September 2026.
--
-- Asked what a refund or chargeback should do, the operator said: revoke the
-- plan AND claw back the referral bonus. Both, so this undoes the two things
-- `confirm_subscription_payment` did.
--
-- HOW THE PLAN IS REVOKED, and why it is not a blunt cancel. A payment either
-- opened a subscription or extended one that was already running. Cancelling
-- outright would, on a renewal, also take away the weeks the user paid for in
-- an earlier untouched payment. So this subtracts exactly the period THIS
-- payment bought, and cancels only when that leaves nothing: for a first
-- purchase the two are the same thing, and the plan goes immediately.
--
-- The clawback takes what is there. `claw_back_referral_points` already
-- refuses to push a balance negative and returns what it recovered, so a
-- referrer who has already withdrawn does not end up owing the platform. The
-- shortfall is recorded rather than enforced, because inventing a debt is a
-- decision for a human.
-- ----------------------------------------------------------------------------
create or replace function public.reverse_subscription_payment(
  p_payment_id uuid,
  p_reason     text default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pay        public.subscription_payments;
  v_sub        public.user_subscriptions;
  v_grace      int;
  v_end        timestamptz;
  v_com        record;
  v_owed       bigint := 0;
  v_recovered  bigint := 0;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  -- Idempotent: the hub may retry, and the sweep may arrive at the same answer.
  if v_pay.status = 'refunded' then
    return v_pay;
  end if;

  /* A payment that never confirmed has nothing to reverse. Mark it failed and
     stop, rather than raising: a reversal event for an unconfirmed payment is
     odd but not a reason to make the hub retry for 24 hours. */
  if v_pay.status <> 'confirmed' then
    return public.fail_subscription_payment(p_payment_id, coalesce(p_reason, 'Reversed before confirmation'));
  end if;

  update public.subscription_payments
     set status = 'refunded',
         failure_reason = coalesce(p_reason, 'Payment reversed')
   where id = p_payment_id
  returning * into v_pay;

  -- 4a. The plan.
  v_grace := public.config_int('subscription_grace_period_days')::int;

  select * into v_sub from public.user_subscriptions
   where user_id = v_pay.user_id
     and tier_id = v_pay.tier_id
     and status in ('active', 'grace')
   for update;

  if found then
    v_end := v_sub.current_period_end - make_interval(days => v_pay.period_days);

    if v_end <= now() then
      update public.user_subscriptions
         set status             = 'cancelled',
             cancelled_at       = now(),
             current_period_end = least(v_sub.current_period_end, now()),
             grace_ends_at      = null,
             updated_at         = now()
       where id = v_sub.id;
    else
      update public.user_subscriptions
         set current_period_end = v_end,
             grace_ends_at      = v_end + make_interval(days => v_grace),
             updated_at         = now()
       where id = v_sub.id;
    end if;
  end if;

  -- 4b. The referral bonus, both levels.
  for v_com in
    select * from public.referral_commissions
     where payment_id = p_payment_id
       and reversed_at is null
     for update
  loop
    v_owed := v_owed + v_com.points;
    v_recovered := v_recovered + public.claw_back_referral_points(
      v_com.referrer_id,
      v_com.points,
      v_com.referral_id,
      jsonb_build_object(
        'payment_id', p_payment_id,
        'commission_id', v_com.id,
        'level', v_com.level,
        'reason', coalesce(p_reason, 'Payment reversed')
      )
    );

    update public.referral_commissions
       set reversed_at = now()
     where id = v_com.id;
  end loop;

  /* An operator has to be able to see a reversal that could not be fully
     recovered, because that is money the platform is out and the only way to
     act on it is to know. */
  if v_owed > v_recovered then
    insert into public.system_alerts (severity, code, message, context)
    values ('warning', 'referral_clawback_short',
            'A payment was reversed but its referral bonus could not be fully recovered.',
            jsonb_build_object(
              'payment_id', p_payment_id,
              'owed_points', v_owed,
              'recovered_points', v_recovered));
  end if;

  return v_pay;
end;
$function$;

revoke execute on function public.reverse_subscription_payment(uuid, text) from public, anon, authenticated;
grant  execute on function public.reverse_subscription_payment(uuid, text) to service_role;
