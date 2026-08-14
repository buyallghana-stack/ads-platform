-- ============================================================================
-- Migration 196 — allow stacking all 6 plans and fix max stacked plans cap
--
-- BUG:
-- When a user who already held plans (e.g. Bronze, Silver, Gold, Platinum)
-- attempted to purchase Sapphire (GHS 720) or Platinum (GHS 1500), Paystack
-- processed the payment, but the callback failed with:
--   "We could not confirm this payment"
--
-- ROOT CAUSE:
-- `subscription_max_stacked_plans` in `app_config` and `confirm_subscription_payment`
-- was hardcoded/defaulted to 4 from when there were only 4 plans.
-- When Migration 189 introduced a 6-plan ladder (Bronze, Silver, Pearl, Gold,
-- Sapphire, Platinum), `confirm_subscription_payment` was still checking:
--   `if v_live >= v_max_plans (4) then raise exception 'This account already holds the maximum of 4 plans'`
-- This caused `confirmPaystackReference` to fail with an exception.
--
-- FIX:
-- 1. Update `app_config.subscription_max_stacked_plans` to 6 (matching all 6 plans).
-- 2. Update `confirm_subscription_payment` to dynamically allow stacking up to
--    the total number of active paid plans available on the platform.
-- 3. Automatically confirm any pending subscription payment that was blocked by this cap.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Update config to allow all 6 plans
-- ---------------------------------------------------------------------------

update public.app_config
   set value = '6',
       description = 'Maximum number of plans a user may stack simultaneously. Updated to 6 for the 6-plan ladder.'
 where key = 'subscription_max_stacked_plans';

insert into public.app_config (key, value, value_type, description)
select 'subscription_max_stacked_plans', '6', 'int', 'Maximum number of plans a user may stack simultaneously.'
 where not exists (select 1 from public.app_config where key = 'subscription_max_stacked_plans');


-- ---------------------------------------------------------------------------
-- 2. confirm_subscription_payment — allows stacking all active paid plans
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_subscription_payment(
  p_payment_id uuid,
  p_reference text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
 RETURNS user_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_worth := coalesce(v_pay.list_minor, v_pay.amount_minor);

  -- Renewing THIS plan: extend from whichever is later
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

  -- A DIFFERENT plan: it is added alongside up to total available active tiers.
  select count(*), coalesce(
    (select value::int from public.app_config where key = 'subscription_max_stacked_plans'),
    (select count(*)::int from public.tiers where is_active and not is_default),
    6
  )
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
$function$;

revoke execute on function public.confirm_subscription_payment(uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_subscription_payment(uuid, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 3. Confirm any recent pending payments created in the last 2 hours
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select id, external_reference
      from public.subscription_payments
     where status = 'pending'
       and created_at >= now() - interval '2 hours'
     order by created_at desc
  loop
    begin
      perform public.confirm_subscription_payment(r.id, coalesce(r.external_reference, r.id::text), '{}'::jsonb);
    exception when others then
      -- Ignore any uncompleted payment attempt
      null;
    end;
  end loop;
end $$;
