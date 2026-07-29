-- ============================================================================
-- Migration 061 — Referral stage three: commission when a referee buys a plan
--
-- The referral programme has paid the referrer twice since migration 021: once
-- when the referee signs up, once when the referee has watched enough ads.
-- Neither is connected to money coming in. The operator asked for the third:
-- when someone you referred BUYS A PLAN, you earn from that purchase.
--
-- WHAT KEEPS THIS OUT OF PYRAMID TERRITORY
-- Paying a commission on a recruit's PURCHASE is the specific mechanic that
-- pyramid-scheme rules are written about, so the structural limits matter more
-- here than anywhere else in the schema:
--
--   * Single level, by construction. There is still no ancestry column
--     anywhere. `profiles.referred_by` is read for attribution and is never
--     walked upward, so a referrer earns from their own referees and from
--     nobody else's — a second-level payout is not switched off, it is
--     unexpressible.
--   * No pay-to-participate. Referring is free, being referred is free, and
--     nothing about holding a plan is required to refer.
--   * The commission cannot exceed the sale. Clamped below, so the platform
--     can never pay out more for a referral than the purchase brought in.
--
-- This still changes what the programme IS, and the published Terms describe
-- the two-stage watch-gated version. It ships defaulted to zero for that
-- reason: with `referral_purchase_commission_percent` at 0 nothing is paid,
-- nothing is recorded, and no promise is made, until the operator and the
-- lawyer decide otherwise (LEGAL_REVIEWED is still false).
--
-- WHY A PERCENTAGE OF THE MONEY, NOT POINTS PER PLAN
-- Migrations 036/037 established that every subscription benefit is linear in
-- money paid, so any combination of plans is ordered by total spend. A fixed
-- points-per-plan commission would break that ordering the moment the admin
-- re-priced a plan in the plan editor, and would have to be re-tuned by hand
-- every time. A percentage of what was actually paid stays correct by itself.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('referral_purchase_commission_percent', '0', 'decimal', 0, 50, false,
   'Stage-three referral commission: the percentage of what a referee pays for a plan that is credited to their referrer, as points at the pegged rate. Zero switches the stage off entirely — no ledger entry and no commission record. The referrer''s own tier multiplier is applied on top, so the effective share of a sale is this percentage times that multiplier.'),

  ('referral_purchase_commission_scope', 'new_plans', 'text', null, null, false,
   'Which of a referee''s purchases earn their referrer a commission. first = their first purchase only. new_plans = the first time they buy each distinct plan, but not renewals (the default; plans stack one-of-each, so this is bounded at one commission per plan per referee, ever). all = every confirmed purchase including every renewal.'),

  ('referral_purchase_commission_cap_points', '0', 'int', 0, null, false,
   'Lifetime ceiling on the total stage-three commission a single referee can generate for their referrer, in points. Zero means no ceiling. A partial payment is made when a purchase would cross it.')
on conflict (key) do nothing;


-- `referral_purchase_commission_scope` is a text setting, so the table's own
-- CHECKs cannot constrain it and an unrecognised value would fall through to
-- whatever the function's else-branch does. Migration 052 built this exact
-- guard for the combine mode after the admin screen offered a mode that did
-- not exist; the same trap is available here, so the same fix is applied
-- before the screen ships rather than after.
create or replace function public.config_allowed_values(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'subscription_multiplier_combine_mode'
      then array['sum_bonus', 'sum', 'product', 'highest']
    when 'referral_purchase_commission_scope'
      then array['first', 'new_plans', 'all']
    else null
  end;
$$;


-- ---------------------------------------------------------------------------
-- referral_commissions — one row per commission actually paid
-- ---------------------------------------------------------------------------
--
-- The `referrals` table records stage one and stage two as two columns because
-- each happens at most once. Stage three can happen several times for the same
-- referral (a referee may buy up to four plans), so it needs its own table.
--
-- Every input to the calculation is frozen into the row, for the same reason
-- the signup and activation bonuses are: re-pricing a plan or changing the
-- percentage must never rewrite what somebody was already paid.

create table public.referral_commissions (
  id uuid primary key default gen_random_uuid(),

  referral_id uuid not null references public.referrals (id) on delete cascade,
  referrer_id uuid not null references auth.users (id) on delete cascade,
  referee_id  uuid not null references auth.users (id) on delete cascade,

  -- RESTRICT, and unique: the payment is the evidence behind the commission,
  -- and one payment may produce at most one commission for all time. This is
  -- the second of two independent guards — see the ledger note below.
  payment_id uuid not null unique references public.subscription_payments (id) on delete restrict,
  tier_id    uuid not null references public.tiers (id) on delete restrict,

  -- What the referee actually paid, copied rather than joined.
  amount_minor  bigint not null check (amount_minor > 0),
  currency_code char(3) not null,

  -- The three inputs, as they stood at the moment of payment.
  percent_applied  numeric(6, 3) not null check (percent_applied > 0),
  tier_multiplier  numeric(6, 3) not null check (tier_multiplier > 0),
  scope_at_payment text not null,

  points bigint not null check (points > 0),

  -- Set by reject_referral. The ledger reversal is a separate compensating
  -- entry; this flag is what stops a reversed commission being counted again
  -- toward the lifetime cap or shown to the user as earned.
  reversed_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.referral_commissions is
  'Stage-three referral commissions (one per subscription payment, at most). Percentage, multiplier and amount are frozen at payment time so re-pricing a plan or changing config never rewrites what was already paid.';

create index referral_commissions_referrer_idx on public.referral_commissions (referrer_id, created_at desc);
create index referral_commissions_referral_idx on public.referral_commissions (referral_id);
create index referral_commissions_referee_idx  on public.referral_commissions (referee_id);
create index referral_commissions_tier_idx     on public.referral_commissions (tier_id);


-- ---------------------------------------------------------------------------
-- pay_referral_purchase_commission
-- ---------------------------------------------------------------------------
--
-- Returns the commission row, or null when no commission is due. "No
-- commission due" is the ordinary case — most buyers were never referred — so
-- it is a null return and not an exception.

create or replace function public.pay_referral_purchase_commission(p_payment_id uuid)
returns public.referral_commissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay      public.subscription_payments;
  v_ref      public.referrals;
  v_referrer public.profiles;
  v_tier     public.tiers;
  v_scope    text;
  v_percent  numeric;
  v_cap      bigint;
  v_paid     bigint;
  v_rate     bigint;
  v_gross    bigint;
  v_points   bigint;
  v_earns    boolean;
  v_row      public.referral_commissions;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  -- Only a payment that actually settled earns anything. Called from inside
  -- confirm_subscription_payment, this is already true; called from anywhere
  -- else it is the thing that must be checked first.
  if v_pay.status <> 'confirmed' then
    return null;
  end if;

  v_percent := coalesce(public.config_decimal('referral_purchase_commission_percent'), 0);
  if v_percent <= 0 then
    return null;                                   -- stage switched off
  end if;

  -- A rejected referral earns nothing further. Pending and activated both do:
  -- requiring activation first would mean a referee who buys a plan on day one
  -- and watches four ads never earns their referrer anything, and a farm
  -- cannot profit from buying plans to milk a commission that is capped below
  -- the price of the plan.
  select * into v_ref from public.referrals
   where referee_id = v_pay.user_id and status <> 'rejected'
   for update;
  if not found then
    return null;
  end if;

  -- Belt and braces. The table's own CHECK makes this impossible, but this is
  -- the money path and self-referral is the fraud it would be built for.
  if v_ref.referrer_id = v_ref.referee_id then
    return null;
  end if;

  select * into v_referrer from public.profiles where id = v_ref.referrer_id;
  if not found or v_referrer.disabled_at is not null then
    -- Same refusal `apply_referral_code` makes, made here rather than by
    -- adding this entry type to the guard list inside credit_points — that
    -- function has been amended by five migrations and restating it to edit
    -- one list is the more dangerous change.
    return null;
  end if;

  -- --- Scope -----------------------------------------------------------
  v_scope := coalesce(
    (select value from public.app_config where key = 'referral_purchase_commission_scope'),
    'new_plans'
  );

  if v_scope = 'all' then
    v_earns := true;

  elsif v_scope = 'first' then
    -- Their first purchase of anything.
    v_earns := not exists (
      select 1 from public.subscription_payments p
       where p.user_id = v_pay.user_id
         and p.status = 'confirmed'
         and p.id <> v_pay.id
    );

  else
    -- 'new_plans' — the first time they buy THIS plan. Renewals of a plan they
    -- already bought do not pay again. Because stacking is one-of-each, this
    -- is bounded at one commission per plan per referee for all time.
    v_earns := not exists (
      select 1 from public.subscription_payments p
       where p.user_id = v_pay.user_id
         and p.tier_id = v_pay.tier_id
         and p.status = 'confirmed'
         and p.id <> v_pay.id
    );
  end if;

  if not v_earns then
    return null;
  end if;

  -- --- Amount ----------------------------------------------------------
  -- amount_minor is pesewas; the peg converts cedis to points. Recomputed from
  -- the payment rather than the tier price, so a plan re-priced between
  -- purchase and confirmation cannot pay a commission on money never received.
  v_rate  := public.config_int('points_per_currency_unit');
  v_gross := (v_pay.amount_minor * v_rate) / 100;

  v_tier := public.resolve_user_tier(v_ref.referrer_id);

  v_points := floor(v_gross * (v_percent / 100.0) * v_tier.referral_bonus_multiplier)::bigint;

  -- THE STRUCTURAL LIMIT. The percentage is capped at 50 by the config row's
  -- own bounds, but the referrer's multiplier is applied on top and can reach
  -- 3.0, which would otherwise let a sale pay out more than it took in. A
  -- referral must never cost more than the purchase it rewards.
  v_points := least(v_points, v_gross);

  if v_points <= 0 then
    return null;
  end if;

  -- --- Lifetime cap for this referee ------------------------------------
  v_cap := coalesce(public.config_int('referral_purchase_commission_cap_points'), 0);
  if v_cap > 0 then
    select coalesce(sum(points), 0) into v_paid
      from public.referral_commissions
     where referral_id = v_ref.id and reversed_at is null;

    -- Pay the remainder rather than nothing: a purchase that crosses the
    -- ceiling should pay up to it, not silently pay zero.
    v_points := least(v_points, v_cap - v_paid);
    if v_points <= 0 then
      return null;
    end if;
  end if;

  -- --- Credit ------------------------------------------------------------
  -- reference (subscription_payment, payment id) is load-bearing: it is the
  -- first of the two idempotency guards, via points_ledger_source_once_idx,
  -- which raises 23505 if this same referrer is ever credited for this same
  -- payment twice. The unique payment_id on referral_commissions is the other.
  perform public.credit_points(
    v_ref.referrer_id,
    v_points,
    'referral_purchase',
    'subscription_payment',
    v_pay.id::text,
    jsonb_build_object(
      'referral_id',     v_ref.id,
      'referee_id',      v_ref.referee_id,
      'tier_id',         v_pay.tier_id,
      'amount_minor',    v_pay.amount_minor,
      'percent',         v_percent,
      'tier_multiplier', v_tier.referral_bonus_multiplier,
      'scope',           v_scope
    )
  );

  insert into public.referral_commissions
    (referral_id, referrer_id, referee_id, payment_id, tier_id,
     amount_minor, currency_code, percent_applied, tier_multiplier,
     scope_at_payment, points)
  values
    (v_ref.id, v_ref.referrer_id, v_ref.referee_id, v_pay.id, v_pay.tier_id,
     v_pay.amount_minor, v_pay.currency_code, v_percent, v_tier.referral_bonus_multiplier,
     v_scope, v_points)
  returning * into v_row;

  perform public.create_notification(
    v_ref.referrer_id,
    'payout',
    'You earned a referral commission',
    'Someone you invited bought a plan. ' || v_points::text || ' points have been added to your balance.',
    jsonb_build_object('referral_commission_id', v_row.id, 'points', v_points)
  );

  return v_row;
end;
$$;

comment on function public.pay_referral_purchase_commission(uuid) is
  'Stage three of the referral programme: credits the referrer a percentage of a confirmed subscription payment. Returns null when no commission is due, which is the ordinary case.';

revoke execute on function public.pay_referral_purchase_commission(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- confirm_subscription_payment — restated to pay the commission
-- ---------------------------------------------------------------------------
--
-- Restated in full from migration 038 (the stacking-safe version) with the
-- commission call added on the two paths that actually transition a payment
-- from pending to confirmed. The already-confirmed early return does NOT call
-- it: a retried webhook must not attempt a second commission.
--
-- THE COMMISSION CANNOT BREAK THE PURCHASE. It runs inside an exception block
-- that records a system alert and carries on. A referral bonus failing for any
-- reason — a disabled referrer, a cap edge, a bug in the arithmetic — must
-- never roll back a subscription somebody actually paid money for. The alert
-- is how the operator finds out instead of nobody finding out.

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
    than a second period or a second row — or, now, a second commission.
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
    (user_id, tier_id, status, current_period_end, grace_ends_at)
  values
    (v_pay.user_id, v_pay.tier_id, 'active', v_end, v_end + make_interval(days => v_grace))
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
$$;


-- ---------------------------------------------------------------------------
-- reject_referral — restated to claw back stage three as well
-- ---------------------------------------------------------------------------
--
-- The original clawed back the signup and activation bonuses. A rejected
-- referral that keeps its purchase commissions would leave the largest of the
-- three payouts in the fraudster's balance, which is the wrong way round.
--
-- Unchanged from migration 021: the claw-back takes what is actually there
-- rather than driving the balance negative, and the REFEREE keeps everything
-- they earned by watching. They may simply have been recruited by someone
-- abusive. Their subscription is also untouched — they paid real money for it.

create or replace function public.reject_referral(
  p_admin_id    uuid,
  p_referral_id uuid,
  p_reason      text
)
returns public.referrals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref        public.referrals;
  v_total      bigint;
  v_commission bigint;
  v_bal        bigint;
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = 'check_violation';
  end if;

  select * into v_ref from public.referrals where id = p_referral_id for update;
  if not found then
    raise exception 'Referral not found' using errcode = 'check_violation';
  end if;
  if v_ref.status = 'rejected' then
    raise exception 'Already rejected' using errcode = 'check_violation';
  end if;

  select coalesce(sum(points), 0) into v_commission
    from public.referral_commissions
   where referral_id = p_referral_id and reversed_at is null;

  v_total := coalesce(v_ref.signup_bonus_points, 0)
           + coalesce(v_ref.activation_bonus_points, 0)
           + v_commission;

  if v_total > 0 then
    select coalesce(balance, 0) into v_bal from public.user_balances where user_id = v_ref.referrer_id;

    -- Claw back what is actually there. A negative balance is not
    -- representable, and chasing a shortfall through the ledger would be worse
    -- than recording that it could not be fully recovered.
    v_total := least(v_total, coalesce(v_bal, 0));

    if v_total > 0 then
      perform public.debit_points(
        v_ref.referrer_id, v_total, 'admin_adjustment', 'referral_reversal', p_referral_id::text,
        jsonb_build_object('reason', trim(p_reason), 'rejected_by', p_admin_id,
                           'commission_points', v_commission)
      );
    end if;
  end if;

  -- Marked reversed whether or not the balance covered the claw-back: the
  -- commission is no longer owed, and the lifetime cap must not keep counting
  -- points that have been reversed.
  update public.referral_commissions
     set reversed_at = now()
   where referral_id = p_referral_id and reversed_at is null;

  update public.referrals
     set status = 'rejected', rejected_reason = trim(p_reason),
         rejected_by = p_admin_id, updated_at = now()
   where id = p_referral_id
  returning * into v_ref;

  return v_ref;
end;
$$;

revoke execute on function public.reject_referral(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- get_referral_summary — stage three included
-- ---------------------------------------------------------------------------
--
-- Drop and recreate: the return type gains two columns, which CREATE OR
-- REPLACE cannot do. `points_earned` now covers all three stages, because the
-- referral card shows it as "points earned from invites" and leaving the
-- largest stage out of that number would make the screen lie.

drop function if exists public.get_referral_summary(uuid);

create or replace function public.get_referral_summary(p_user_id uuid)
returns table (
  referral_code     text,
  total_referred    int,
  activated_count   int,
  pending_count     int,
  points_earned     bigint,
  ads_required      int,
  purchases_count   int,
  commission_points bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.referral_code,
    coalesce(r.total, 0)::int,
    coalesce(r.activated, 0)::int,
    coalesce(r.pending, 0)::int,
    (coalesce(r.points, 0) + coalesce(c.points, 0))::bigint,
    public.config_int('referral_activation_ads_required')::int,
    coalesce(c.purchases, 0)::int,
    coalesce(c.points, 0)::bigint
  from public.profiles p
  left join (
    select referrer_id,
           count(*) filter (where status <> 'rejected')  as total,
           count(*) filter (where status = 'activated')  as activated,
           count(*) filter (where status = 'pending')    as pending,
           sum(case when status = 'rejected' then 0
                    else signup_bonus_points + activation_bonus_points end) as points
    from public.referrals group by referrer_id
  ) r on r.referrer_id = p.id
  left join (
    select referrer_id,
           count(*)          as purchases,
           sum(points)       as points
    from public.referral_commissions
    where reversed_at is null
    group by referrer_id
  ) c on c.referrer_id = p.id
  where p.id = p_user_id;
end;
$$;

revoke execute on function public.get_referral_summary(uuid) from public, anon;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- Same shape as `referrals`: both sides of the relationship may read it,
-- nobody may write it. Note the referee can see the commission their purchase
-- generated — that is deliberate. Someone paying for a plan is entitled to
-- know their referrer was paid for it.

alter table public.referral_commissions enable row level security;

create policy "Read own referral commissions or all as admin"
  on public.referral_commissions for select
  to authenticated
  using ((select auth.uid()) in (referrer_id, referee_id) or public.is_admin());
