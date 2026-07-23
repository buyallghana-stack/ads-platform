-- ============================================================================
-- Migration 020 — Subscriptions (§6.7)
--
-- Tier purchase, renewal, grace and auto-downgrade. The tiers themselves are
-- already data (migration 004); this adds payment and lifecycle.
--
-- A bug fixed here first
-- ----------------------
-- resolve_user_tier() matched on status alone: `status in ('active','grace')`.
-- It never compared current_period_end. So a subscription whose paid period
-- had ended still granted paid perks until the expiry sweep happened to run —
-- a user could keep a higher daily cap and a lower redemption minimum for
-- however long the scheduler was late or wedged.
--
-- Correctness must not depend on a job running on time. The function now
-- checks the dates directly:
--   active, and now() < current_period_end          -> the paid tier
--   grace,  and now() < grace_ends_at               -> the paid tier
--   otherwise                                       -> the default tier
--
-- expire_subscriptions() still runs, but only to keep `status` truthful for
-- reporting and queues. If it never ran, entitlement would still be right.
--
-- On expiry, already-earned points are untouched (§6.7). Nothing here touches
-- the ledger; downgrading changes what a user earns next, never what they have
-- already earned. Redemptions likewise honour the terms captured at request
-- time, because request_redemption snapshots the rate and checked the minimum
-- then.
-- ============================================================================


create type public.subscription_payment_method as enum ('korapay', 'crypto');

create type public.subscription_payment_status as enum (
  'pending',    -- initiated, awaiting the provider
  'confirmed',  -- provider confirmed; subscription started or extended
  'failed',
  'refunded'
);


create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users (id) on delete restrict,
  tier_id uuid not null references public.tiers (id) on delete restrict,

  method public.subscription_payment_method not null,
  status public.subscription_payment_status not null default 'pending',

  -- Minor units, like every other money column here. Never float.
  amount_minor  bigint not null check (amount_minor > 0),
  currency_code char(3) not null default 'GHS',

  -- Billing period bought, captured at purchase. If an admin later changes the
  -- tier's billing_period_days, that must not retroactively shorten or extend
  -- a period someone already paid for.
  period_days int not null check (period_days between 1 and 3650),

  external_reference text,
  provider_payload   jsonb not null default '{}'::jsonb,
  failure_reason     text,

  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,

  constraint subscription_payments_confirmed_has_time
    check (status <> 'confirmed' or confirmed_at is not null)
);

comment on table public.subscription_payments is
  'Subscription purchases. period_days is captured at purchase so changing a tier later cannot alter a period already paid for.';

create index subscription_payments_user_idx   on public.subscription_payments (user_id, created_at desc);
create index subscription_payments_status_idx on public.subscription_payments (status, created_at desc);
create index subscription_payments_tier_idx   on public.subscription_payments (tier_id);
create unique index subscription_payments_ref_idx
  on public.subscription_payments (method, external_reference)
  where external_reference is not null;

create trigger subscription_payments_audit
  after insert or update or delete on public.subscription_payments
  for each row execute function public.audit_row_change('id');


-- ---------------------------------------------------------------------------
-- resolve_user_tier — corrected
-- ---------------------------------------------------------------------------

create or replace function public.resolve_user_tier(p_user_id uuid)
returns public.tiers
language plpgsql
stable
set search_path = ''
as $$
declare
  result public.tiers;
begin
  -- Entitlement is decided by the dates, not by whether a sweep has run.
  select t.* into result
    from public.user_subscriptions s
    join public.tiers t on t.id = s.tier_id
   where s.user_id = p_user_id
     and (
       (s.status = 'active' and now() < s.current_period_end)
       or
       (s.status = 'grace'  and s.grace_ends_at is not null and now() < s.grace_ends_at)
     )
   limit 1;

  if found then
    return result;
  end if;

  select t.* into result from public.tiers t where t.is_default limit 1;
  return result;
end;
$$;

comment on function public.resolve_user_tier(uuid) is
  'Authoritative current tier. Checks period and grace dates directly so entitlement never depends on the expiry sweep having run.';


-- ---------------------------------------------------------------------------
-- start_subscription_payment
-- ---------------------------------------------------------------------------

create or replace function public.start_subscription_payment(
  p_user_id uuid,
  p_tier_id uuid,
  p_method  public.subscription_payment_method
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier public.tiers;
  v_row  public.subscription_payments;
  v_prof public.profiles;
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

  insert into public.subscription_payments (
    user_id, tier_id, method, amount_minor, currency_code, period_days
  )
  values (
    p_user_id, p_tier_id, p_method, v_tier.price_minor, v_tier.currency_code, v_tier.billing_period_days
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.start_subscription_payment(uuid, uuid, public.subscription_payment_method)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- confirm_subscription_payment — the only path that grants a paid tier
-- ---------------------------------------------------------------------------
--
-- Called from the server after the provider confirms. Extends an existing
-- subscription rather than replacing it, so renewing early adds time instead
-- of discarding what was already paid for.

create or replace function public.confirm_subscription_payment(
  p_payment_id uuid,
  p_reference  text,
  p_payload    jsonb default '{}'::jsonb
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay   public.subscription_payments;
  v_sub   public.user_subscriptions;
  v_grace int;
  v_from  timestamptz;
  v_end   timestamptz;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  -- Providers retry webhooks. Confirming twice must not grant two periods.
  if v_pay.status = 'confirmed' then
    select * into v_sub from public.user_subscriptions
     where user_id = v_pay.user_id and status in ('active','grace') limit 1;
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

  select * into v_sub from public.user_subscriptions
   where user_id = v_pay.user_id and status in ('active','grace')
   for update;

  if found and v_sub.tier_id = v_pay.tier_id then
    -- Renewing the same tier: extend from whichever is later, so paying early
    -- never loses time already bought.
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

  elsif found then
    -- Switching tiers: close the old one and open the new. The partial unique
    -- index allows only one live subscription per user.
    update public.user_subscriptions
       set status = 'cancelled', cancelled_at = now(), updated_at = now()
     where id = v_sub.id;

    v_end := now() + make_interval(days => v_pay.period_days);
    insert into public.user_subscriptions (user_id, tier_id, status, current_period_end, grace_ends_at)
    values (v_pay.user_id, v_pay.tier_id, 'active', v_end, v_end + make_interval(days => v_grace))
    returning * into v_sub;

  else
    v_end := now() + make_interval(days => v_pay.period_days);
    insert into public.user_subscriptions (user_id, tier_id, status, current_period_end, grace_ends_at)
    values (v_pay.user_id, v_pay.tier_id, 'active', v_end, v_end + make_interval(days => v_grace))
    returning * into v_sub;
  end if;

  return v_sub;
end;
$$;

revoke execute on function public.confirm_subscription_payment(uuid, text, jsonb)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- cancel_subscription — stop renewing, keep what was paid for
-- ---------------------------------------------------------------------------

create or replace function public.cancel_subscription(p_user_id uuid)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare v_sub public.user_subscriptions;
begin
  select * into v_sub from public.user_subscriptions
   where user_id = p_user_id and status in ('active','grace') for update;

  if not found then
    raise exception 'No active subscription to cancel' using errcode = 'check_violation';
  end if;

  -- Cancelling marks intent not to renew. The user keeps the tier until the
  -- period they paid for runs out; taking perks away immediately would be
  -- taking back something already bought.
  update public.user_subscriptions
     set cancelled_at = now(), updated_at = now()
   where id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$$;

revoke execute on function public.cancel_subscription(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- expire_subscriptions — housekeeping sweep
-- ---------------------------------------------------------------------------
--
-- Keeps `status` truthful. Entitlement no longer depends on this running, but
-- the admin queues and reports do.

create or replace function public.expire_subscriptions()
returns table (to_grace int, to_expired int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grace_days int := public.config_int('subscription_grace_period_days')::int;
  v_a int; v_b int;
begin
  -- Paid period ended -> grace (§6.7)
  update public.user_subscriptions
     set status        = 'grace',
         grace_ends_at = coalesce(grace_ends_at, current_period_end + make_interval(days => v_grace_days)),
         updated_at    = now()
   where status = 'active'
     and current_period_end <= now();
  get diagnostics v_a = row_count;

  -- Grace ended, or cancelled and the paid period is over -> expired, which
  -- means resolve_user_tier falls back to the default tier: the auto-downgrade
  -- §6.7 asks for. Earned points are untouched.
  update public.user_subscriptions
     set status = 'expired', updated_at = now()
   where status = 'grace'
     and grace_ends_at is not null
     and grace_ends_at <= now();
  get diagnostics v_b = row_count;

  return query select v_a, v_b;
end;
$$;

revoke execute on function public.expire_subscriptions() from public, anon, authenticated;


-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.subscription_payments enable row level security;

create policy "Read own payments or all as admin"
  on public.subscription_payments for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

-- No write policy. A user who could insert a confirmed payment would grant
-- themselves a paid tier for free.
