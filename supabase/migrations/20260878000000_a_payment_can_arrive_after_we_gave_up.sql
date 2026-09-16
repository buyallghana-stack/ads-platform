-- ============================================================================
-- Migration 230 — a payment can arrive after we gave up on it
--
-- WHAT WAS WRONG. `confirm_subscription_payment` raised on any payment that was
-- not `pending` or already `confirmed`:
--
--     if v_pay.status <> 'pending' then
--       raise exception 'Payment is % and cannot be confirmed', v_pay.status;
--     end if;
--
-- A closed payment is not the same as a payment that never happened. Three
-- things close one here without Paystack ever being asked: the reconciliation
-- sweep at 48 hours, the hub answering `failed`, and the hub answering
-- `abandoned`. If a genuine `payment.success` then arrives for that reference,
-- `applyHubEvent` calls this function, this function raises, and
-- `/api/internal/hub/confirm` answers 500. The hub reads a 500 as "come back
-- later", retries for 24 hours on its ladder, gives up, and a buyer who paid
-- holds no plan. Nobody is told, because on our side it looks like a payment
-- that failed and on theirs like a delivery that could not be made.
--
-- WHY IT IS LIVE NOW RATHER THAN THEORETICAL. The Tech Store shipped an
-- abandonment sweep on 16 September 2026 that asks Paystack about every stale
-- intent and SETTLES the ones Paystack says were paid, queueing the
-- notification as it goes (`for-sideperks.md`, section 4). A late
-- `payment.success` is a thing that endpoint is now designed to send. Their
-- settle function accepts a payment from any status except `reversed`; ours
-- accepted one status. This makes the two sides agree.
--
-- THE FIX. A `failed` payment may be confirmed. Nothing else changes, and the
-- refusals that matter are kept:
--
--   * `refunded` still raises. Money that was given back must not silently
--     become a live plan on the strength of a late event.
--   * `confirmed` is still the idempotent no-op it was.
--   * The amount is still checked before this function is ever reached, in
--     `applyHubEvent`, so a late success at the wrong figure is flagged for an
--     admin rather than granted.
--
-- A confirmation that arrives this way clears the failure reason, because a
-- row cannot both hold a plan and explain why it did not, and writes a
-- `late_payment_confirmed` alert so that a person sees it happened. It is a
-- rare event and a loud one: a buyer was told their payment did not work and
-- now has the plan.
--
-- The body below is otherwise migration 198 unchanged.
-- ============================================================================

create or replace function public.confirm_subscription_payment(
  p_payment_id uuid,
  p_reference text,
  p_payload jsonb default '{}'::jsonb
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path to ''
as $function$
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
  v_was_closed        boolean;
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

  /* ⚠️ `failed` IS ALLOWED THROUGH, `refunded` IS NOT. See the header. A
     payment we closed on a clock is not evidence that no money moved; a
     payment we refunded is evidence that it moved and came back. */
  if v_pay.status not in ('pending', 'failed') then
    raise exception 'Payment is % and cannot be confirmed', v_pay.status
      using errcode = 'check_violation';
  end if;

  v_was_closed := v_pay.status = 'failed';

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
         provider_payload = coalesce(p_payload, '{}'::jsonb),
         /* A confirmed row must not still carry the sentence explaining why it
            failed. The fact that it did is in the alert below and in
            `hub_inbound_events`, which is where a history belongs. */
         failure_reason = case when v_was_closed then null else v_pay.failure_reason end
   where id = p_payment_id;

  if v_was_closed then
    insert into public.system_alerts (severity, code, message, context)
    values ('warning', 'late_payment_confirmed',
            'A payment that had been closed as failed was confirmed by the payment hub.',
            jsonb_build_object(
              'payment_id', p_payment_id,
              'reference', p_reference,
              'user_id', v_pay.user_id,
              'was_failed_because', v_pay.failure_reason,
              'payload', coalesce(p_payload, '{}'::jsonb)));
  end if;

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

/* ⚠️ `create or replace function` RE-GRANTS EXECUTE TO PUBLIC. Every redefinition
   of a money function has to close it again or the anon key can call it. */
revoke execute on function public.confirm_subscription_payment(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.confirm_subscription_payment(uuid, text, jsonb) to service_role;
