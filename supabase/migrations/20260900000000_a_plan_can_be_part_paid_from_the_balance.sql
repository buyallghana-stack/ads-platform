-- ============================================================================
-- Migration 240: a plan can be part paid from the balance, the rest by Paystack
--
-- Operator, 2026-09-25: when the balance does not reach the price, the buyer
-- is told what is left, pays that through Paystack, and when the payment is
-- done the balance is taken and the plan is given.
--
-- HOW IT IS HELD TOGETHER
--
-- One `subscription_payments` row, method `paystack`, exactly as a card
-- purchase. Only two things differ:
--
--   amount_minor    the CASH part, which is what the hub is asked to charge
--                   and what the amount check in `applyHubEvent` compares to
--   balance_minor   the part the balance covers, and balance_points what that
--                   is in points
--   list_minor      set to the full price, so `confirm_subscription_payment`
--                   grants the plan at what it is worth, not at the remainder
--
-- The deposit screens sum `amount_minor`, so only the cash that actually
-- arrived is counted. Nothing in migration 239's totals needs to change.
--
-- ⚠️ THE POINTS ARE SET ASIDE WHEN THE BUYER LEAVES FOR PAYSTACK, NOT AFTER.
-- Taking them only once Paystack confirms leaves a window in which the buyer
-- can spend or withdraw them, and a confirmation must never fail (the hub
-- reads a failure as "retry" and a paid customer ends up with no plan). So the
-- hold is a real debit at the start, and it is given back if the cash half
-- never arrives. From the buyer's side the outcome is the one the operator
-- described: they pay the rest, and the plan arrives with the balance spent.
--
-- WHEN THE HOLD COMES BACK (a trigger, like migration 235, so that neither
-- `confirm_subscription_payment` nor the hub's fail and reverse functions are
-- rewritten from a migration file that may not match the live body)
--
--   pending   -> failed     refused at the hub, abandoned, swept at 48 hours
--   confirmed -> refunded   reversed at Paystack; the plan is revoked, so the
--                           points that paid for part of it come back too
--   failed    -> confirmed  a late success after the hold was returned: the
--                           points are taken again. If the buyer no longer has
--                           them the plan is still granted, because the cash
--                           did arrive, and an alert tells a person.
--
-- The return is `plan_purchase_release`, written directly as the exact
-- inverse of `debit_points`. It does NOT go through `credit_points`, which
-- would count it as new earnings, add it to the reward pool's daily issuance,
-- and refuse it for a disabled account or during an earning pause. Handing
-- back somebody's own points is none of those things.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

alter table public.subscription_payments
  add column if not exists balance_minor  bigint,
  add column if not exists balance_points bigint,
  add column if not exists balance_held   boolean not null default false;

alter table public.subscription_payments
  drop constraint if exists subscription_payments_balance_part_positive;
alter table public.subscription_payments
  add constraint subscription_payments_balance_part_positive
  check (
    (balance_minor is null and balance_points is null)
    or (balance_minor > 0 and balance_points > 0)
  );

comment on column public.subscription_payments.balance_minor is
  'Part paid from the account balance, in minor units, when a plan is part paid from the balance and part through Paystack. amount_minor is then only the cash part. Migration 240.';
comment on column public.subscription_payments.balance_points is
  'balance_minor in points, as set aside when the checkout started.';
comment on column public.subscription_payments.balance_held is
  'Whether balance_points are currently taken from the balance for this payment. Maintained by trg_plan_balance_hold.';


-- ---------------------------------------------------------------------------
-- 2. Giving a hold back
-- ---------------------------------------------------------------------------

create or replace function public.release_plan_balance_hold(
  p_user_id        uuid,
  p_points         bigint,
  p_reference_type text,
  p_payment_id     uuid,
  p_metadata       jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_balance bigint;
begin
  if coalesce(p_points, 0) <= 0 then
    return;
  end if;

  /* The inverse of debit_points: balance back up, lifetime_spent back down.
     lifetime_earned is untouched because nothing was earned. */
  update public.user_balances
     set balance        = balance + p_points,
         lifetime_spent = greatest(lifetime_spent - p_points, 0),
         updated_at     = now()
   where user_id = p_user_id
  returning balance into v_new_balance;

  if not found then
    raise exception 'No balance row for user %', p_user_id using errcode = 'check_violation';
  end if;

  insert into public.points_ledger (
    user_id, entry_type, amount, balance_after,
    reference_type, reference_id, points_per_currency_unit, metadata
  )
  values (
    p_user_id, 'plan_purchase_release', p_points, v_new_balance,
    p_reference_type, p_payment_id::text,
    public.config_int('points_per_currency_unit'),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.release_plan_balance_hold(uuid, bigint, text, uuid, jsonb)
  from public, anon, authenticated;
grant  execute on function public.release_plan_balance_hold(uuid, bigint, text, uuid, jsonb)
  to service_role;


-- ---------------------------------------------------------------------------
-- 3. The trigger that keeps the hold in step with the payment
-- ---------------------------------------------------------------------------
--
-- BEFORE UPDATE, so `balance_held` is set on the same row write rather than
-- by a second update. The ledger's unique index on
-- (user, entry_type, reference_type, reference_id) is what makes each step
-- happen at most once: the first hold and its return use reference_type
-- `subscription_payment`, and the one further cycle a late success can cause
-- uses `subscription_payment_late`. No status sequence allows a third, since
-- `confirm_subscription_payment` refuses a refunded payment.

create or replace function public.plan_balance_hold_follows_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref     text;
  v_balance bigint;
begin
  if new.balance_points is null or new.status = old.status then
    return new;
  end if;

  -- The cash half did not arrive, or was taken back: return the points.
  if new.status in ('failed', 'refunded') and old.balance_held then
    v_ref := case
      when exists (
        select 1 from public.points_ledger
         where user_id = new.user_id and entry_type = 'plan_purchase_release'
           and reference_type = 'subscription_payment' and reference_id = new.id::text)
      then 'subscription_payment_late'
      else 'subscription_payment'
    end;

    perform public.release_plan_balance_hold(
      new.user_id, new.balance_points, v_ref, new.id,
      jsonb_build_object('payment_id', new.id, 'tier_id', new.tier_id,
                         'from_status', old.status, 'to_status', new.status));
    new.balance_held := false;
    return new;
  end if;

  -- A late success after the points were returned: take them again.
  if new.status = 'confirmed' and not old.balance_held then
    select coalesce(balance, 0) into v_balance
      from public.user_balances where user_id = new.user_id;

    if coalesce(v_balance, 0) >= new.balance_points then
      perform public.debit_points(
        new.user_id, new.balance_points, 'plan_purchase',
        'subscription_payment_late', new.id::text,
        jsonb_build_object('payment_id', new.id, 'tier_id', new.tier_id,
                           'balance_minor', new.balance_minor, 'late', true));
      new.balance_held := true;
    else
      /* ⚠️ Never raise here. This runs inside the confirmation, and a raise
         would leave a buyer whose cash arrived without the plan. */
      insert into public.system_alerts (severity, code, message, context)
      values ('warning', 'plan_balance_part_unrecovered',
              'A part-balance plan payment was confirmed late, after its points had been returned, and the buyer no longer had enough balance to take them again. The plan was granted.',
              jsonb_build_object('payment_id', new.id, 'user_id', new.user_id,
                                 'points_owed', new.balance_points,
                                 'balance_now', coalesce(v_balance, 0)));
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.plan_balance_hold_follows_status() from public, anon, authenticated;

drop trigger if exists trg_plan_balance_hold on public.subscription_payments;
create trigger trg_plan_balance_hold
  before update of status on public.subscription_payments
  for each row
  when (new.balance_points is not null)
  execute function public.plan_balance_hold_follows_status();


-- ---------------------------------------------------------------------------
-- 4. Starting a part-balance checkout
-- ---------------------------------------------------------------------------

create or replace function public.start_plan_topup_payment(
  p_user_id uuid,
  p_tier_id uuid,
  p_amount_minor bigint default null,
  p_coupon_code text default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay           public.subscription_payments;
  v_rate          bigint := public.config_int('points_per_currency_unit');
  v_charge        bigint;
  v_balance       bigint;
  v_balance_minor bigint;
  v_points        bigint;
begin
  if p_user_id is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  if not coalesce(public.config_bool('plan_balance_purchase_enabled'), false) then
    raise exception 'Buying a plan with your balance is not available right now'
      using errcode = 'check_violation';
  end if;

  /* Band, coming soon, disabled account and coupon: all checked in here,
     exactly as for a plain Paystack purchase. */
  select * into v_pay
    from public.start_subscription_payment(
      p_user_id, p_tier_id, 'paystack'::public.subscription_payment_method,
      p_amount_minor, p_coupon_code);

  v_charge := v_pay.amount_minor;

  select coalesce(balance, 0) into v_balance
    from public.user_balances where user_id = p_user_id
    for update;
  v_balance := coalesce(v_balance, 0);

  /* Whole pesewas the balance can cover, and the points that costs. Rounded
     down, so the buyer is never charged a point more than the price. */
  v_balance_minor := floor((v_balance::numeric * 100) / v_rate);
  v_points        := least(v_balance, round((v_balance_minor::numeric * v_rate) / 100.0)::bigint);

  if v_balance_minor >= v_charge then
    raise exception 'Your balance covers this plan in full. Pay from your balance instead.'
      using errcode = 'check_violation';
  end if;

  if v_balance_minor <= 0 or v_points <= 0 then
    raise exception 'Your balance is empty, so there is nothing to put towards this plan.'
      using errcode = 'check_violation';
  end if;

  update public.subscription_payments
     set amount_minor   = v_charge - v_balance_minor,
         /* The plan is worth the full price, not the cash part. When a coupon
            already set list_minor it is the band amount and stays. */
         list_minor     = coalesce(list_minor, v_charge),
         balance_minor  = v_balance_minor,
         balance_points = v_points,
         balance_held   = true
   where id = v_pay.id
  returning * into v_pay;

  perform public.debit_points(
    p_user_id, v_points, 'plan_purchase', 'subscription_payment', v_pay.id::text,
    jsonb_build_object(
      'payment_id', v_pay.id,
      'tier_id', p_tier_id,
      'balance_minor', v_balance_minor,
      'cash_minor', v_pay.amount_minor,
      'split', true));

  return v_pay;
end;
$$;

revoke execute on function public.start_plan_topup_payment(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant  execute on function public.start_plan_topup_payment(uuid, uuid, bigint, text)
  to service_role;
