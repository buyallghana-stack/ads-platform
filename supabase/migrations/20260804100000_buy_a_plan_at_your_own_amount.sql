-- ============================================================================
-- Migration 099 — paying your own amount, and the server deciding whether it
-- is allowed
--
-- The browser now sends how much as well as which plan, and that is exactly
-- the kind of number a tampered request would love to change. So the rule
-- lives here: the amount must land inside the band of the plan being bought,
-- and the band comes from the plans table rather than from anything the client
-- said.
--
-- THE TOP BAND IS A SINGLE PRICE. There is nothing above Diamond to
-- interpolate towards, so paying more than its price would buy nothing at all.
-- Rather than take the money and give nothing for it, the amount is required
-- to be exactly the price — the one case where "flexible" would be a lie.
--
-- RENEWING REPLACES THE AMOUNT, it does not add to it. Somebody who renews
-- Bronze at GHS 120 having first paid GHS 80 is on GHS 120, not GHS 200 —
-- their plan is worth what they last paid for it. Adding a DIFFERENT plan is
-- what adds, because that is a second thing held at the same time, and
-- `resolve_user_tier` sums what is live.
-- ============================================================================


/** The top of a plan's band: one pesewa under the next plan, or its own price
 *  when it is the top plan. */
create or replace function public.plan_band_max_minor(p_tier_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  with rungs as (
    select id, price_minor,
           lead(price_minor) over (order by sort_order) as next_price
      from public.tiers
     where is_active
  )
  select case
           when r.next_price is null then r.price_minor
           else r.next_price - 1
         end
    from rungs r
   where r.id = p_tier_id;
$$;

comment on function public.plan_band_max_minor(uuid) is
  'The most somebody may pay for this plan. Equal to the price for the top plan, which has nothing above it to interpolate towards.';


create or replace function public.start_subscription_payment(
  p_user_id uuid,
  p_tier_id uuid,
  p_method subscription_payment_method,
  p_amount_minor bigint default null
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

  insert into public.subscription_payments (
    user_id, tier_id, method, amount_minor, currency_code, period_days
  )
  values (
    p_user_id, p_tier_id, p_method, v_amount, v_tier.currency_code, v_tier.billing_period_days
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.start_subscription_payment(uuid, uuid, public.subscription_payment_method, bigint)
  from public, anon, authenticated;
grant execute on function public.start_subscription_payment(uuid, uuid, public.subscription_payment_method, bigint)
  to service_role;

-- The old three-argument shape would still resolve for existing callers and
-- silently charge the floor price, which is the sort of thing that is only
-- discovered by somebody being undercharged. One signature, no ambiguity.
drop function if exists public.start_subscription_payment(uuid, uuid, public.subscription_payment_method);


/* ---------------------------------------------------------------------------
   Confirming: the amount paid lands on the subscription, because that is what
   the benefit is now computed from.
   --------------------------------------------------------------------------- */

create or replace function public.confirm_subscription_payment(p_payment_id uuid, p_reference text, p_payload jsonb DEFAULT '{}'::jsonb)
returns user_subscriptions
language plpgsql
security definer
set search_path = ''
as $function$
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
           amount_minor       = v_pay.amount_minor,
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
     v_pay.amount_minor)
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

revoke execute on function public.confirm_subscription_payment(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.confirm_subscription_payment(uuid, text, jsonb) to service_role;
