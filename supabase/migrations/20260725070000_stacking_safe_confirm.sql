-- ============================================================================
-- Migration 038 — Confirming a payment must not cancel plans the user paid for
--
-- Found while wiring up Paystack. confirm_subscription_payment still
-- implemented the OLD one-live-subscription model: buying a DIFFERENT tier
-- while holding one cancelled the existing subscription and replaced it.
--
--   Kwame holds Bronze (60 days left). He buys Gold.
--   Before this migration:  Bronze is CANCELLED. He paid for it and loses it.
--   After:                  he holds Bronze AND Gold, as the Upgrade screen
--                           promises and as stacking requires.
--
-- This was unreachable until now because nothing could be purchased. It had to
-- be fixed before the first real payment, not after.
--
-- Also adds the 'paystack' payment method (the enum value itself is added
-- separately — Postgres will not create an enum value and use it in the same
-- transaction), and enforces the stacked-plan ceiling at the moment of
-- purchase rather than only when benefits are read.
-- ============================================================================

create or replace function public.confirm_subscription_payment(
  p_payment_id uuid,
  p_reference  text,
  p_payload    jsonb default '{}'::jsonb
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_pay       public.subscription_payments;
  v_sub       public.user_subscriptions;
  v_grace     int;
  v_from      timestamptz;
  v_end       timestamptz;
  v_live      int;
  v_max_plans int;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  /*
    Idempotent by design: a Paystack webhook and the browser callback both
    confirm the same payment, and the webhook may be retried. Returning the
    subscription for THIS payment's tier makes a repeat call a no-op rather
    than a second period or a second row.
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
           cancelled_at       = null,
           updated_at         = now()
     where id = v_sub.id
    returning * into v_sub;

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
    (user_id, tier_id, status, current_period_end, grace_ends_at)
  values
    (v_pay.user_id, v_pay.tier_id, 'active', v_end, v_end + make_interval(days => v_grace))
  returning * into v_sub;

  return v_sub;
end;
$$;
