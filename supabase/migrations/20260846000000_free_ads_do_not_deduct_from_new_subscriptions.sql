-- ============================================================================
-- Migration 198 — free ad completions do not deduct from new paid subscriptions
--
-- When a user watches a free ad in the morning and later upgrades to a paid
-- subscription (e.g. Bronze with 3 ads/day), the free ad completion must NOT
-- be subtracted from their paid plan's quota on day one.
--
-- FIX:
-- In `confirm_subscription_payment`:
-- When a user confirms a paid subscription, if they did not already hold another
-- active paid subscription before this purchase, reset `daily_earning_counters.ads_completed = 0`
-- for today (utc_today()). Their earned points remain in their balance and ledger,
-- and they receive their full paid daily allowance (e.g. all 3 Bronze ads).
-- ============================================================================

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
  v_pay               public.subscription_payments;
  v_sub               public.user_subscriptions;
  v_grace             int;
  v_from              timestamptz;
  v_end               timestamptz;
  v_live              int;
  v_max_plans         int;
  v_worth             bigint;
  v_had_paid_plan     boolean;
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

  -- Check if the user already held any active paid subscription before this confirmation
  select exists (
    select 1 from public.user_subscriptions s
      join public.tiers t on t.id = s.tier_id
     where s.user_id = v_pay.user_id
       and not t.is_default
       and (
         (s.status = 'active' and now() < s.current_period_end)
         or
         (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
       )
  ) into v_had_paid_plan;

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

  -- If this is the user's first paid subscription and they watched a free ad earlier today,
  -- reset today's completed ads counter to 0 so they get their full paid quota immediately.
  if not v_had_paid_plan then
    update public.daily_earning_counters
       set ads_completed = 0
     where user_id = v_pay.user_id
       and day = public.utc_today();
  end if;

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
