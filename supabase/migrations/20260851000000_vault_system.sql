-- ============================================================================
-- Migration 203 — Vault investment system
--
-- Features:
--   - vault_enabled in app_config (admin-toggleable)
--   - vault_plans (admin-configurable investment plans: name, price, days, daily return %)
--   - vault_payments (Paystack funding records)
--   - vault_investments (active and matured locked vaults)
--   - Maturity claim logic crediting points (principal + profit)
-- ============================================================================

-- 1. Extend ledger_entry_type enum
alter type public.ledger_entry_type add value if not exists 'vault_payout';

-- 2. Add vault_enabled to app_config if not exists
insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values ('vault_enabled', 'true', 'bool', null, null, true, 'Controls whether Vault investment plans are open to users')
on conflict (key) do update set is_public = true;

-- 3. Create vault_plans table
create table if not exists public.vault_plans (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  price_minor          bigint not null check (price_minor > 0),
  currency_code        text not null default 'GHS',
  period_days          integer not null check (period_days > 0),
  daily_return_percent numeric(5,2) not null check (daily_return_percent >= 0),
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.vault_plans is 'Investment vault plans configured by administrators';

create index if not exists vault_plans_active_sort_idx on public.vault_plans (is_active, sort_order);

-- 4. Create vault_payments table
create table if not exists public.vault_payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  plan_id            uuid not null references public.vault_plans(id) on delete restrict,
  amount_minor       bigint not null check (amount_minor > 0),
  currency_code      text not null default 'GHS',
  status             text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  method             text not null default 'paystack',
  external_reference text unique,
  provider_payload   jsonb default '{}'::jsonb,
  failure_reason     text,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists vault_payments_user_idx on public.vault_payments (user_id, created_at desc);

-- 5. Create vault_investments table
create table if not exists public.vault_investments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete restrict,
  plan_id               uuid not null references public.vault_plans(id) on delete restrict,
  plan_name             text not null,
  amount_minor          bigint not null check (amount_minor > 0),
  currency_code         text not null default 'GHS',
  daily_return_percent  numeric(5,2) not null check (daily_return_percent >= 0),
  period_days           integer not null check (period_days > 0),
  started_at            timestamptz not null default now(),
  ends_at               timestamptz not null,
  status                text not null default 'active' check (status in ('active', 'claimed')),
  expected_profit_minor bigint not null check (expected_profit_minor >= 0),
  expected_return_minor bigint not null check (expected_return_minor > 0),
  payment_id            uuid references public.vault_payments(id),
  claimed_at            timestamptz,
  claimed_points        bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists vault_investments_user_idx on public.vault_investments (user_id, created_at desc);
create index if not exists vault_investments_status_ends_idx on public.vault_investments (status, ends_at);

-- 6. Row Level Security
alter table public.vault_plans enable row level security;
alter table public.vault_payments enable row level security;
alter table public.vault_investments enable row level security;

-- Policies for vault_plans
create policy "vault_plans_select_all"
  on public.vault_plans for select
  using (is_active = true or public.is_admin());

create policy "vault_plans_admin_manage"
  on public.vault_plans for all
  using (public.is_admin())
  with check (public.is_admin());

-- Policies for vault_payments
create policy "vault_payments_select_owner"
  on public.vault_payments for select
  using (user_id = (select auth.uid()) or public.is_admin());

-- Policies for vault_investments
create policy "vault_investments_select_owner"
  on public.vault_investments for select
  using (user_id = (select auth.uid()) or public.is_admin());


-- 7. Functions

-- (A) Start Vault Payment
create or replace function public.start_vault_payment(
  p_user_id      uuid,
  p_plan_id      uuid
)
returns public.vault_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.vault_plans;
  v_pay  public.vault_payments;
begin
  if not coalesce(public.config_bool('vault_enabled'), false) then
    raise exception 'Vault is currently disabled' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.vault_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'Vault plan not found or inactive' using errcode = 'check_violation';
  end if;

  insert into public.vault_payments (
    user_id, plan_id, amount_minor, currency_code, status, method
  )
  values (
    p_user_id, v_plan.id, v_plan.price_minor, v_plan.currency_code, 'pending', 'paystack'
  )
  returning * into v_pay;

  return v_pay;
end;
$$;

revoke execute on function public.start_vault_payment(uuid, uuid) from public, anon;
grant execute on function public.start_vault_payment(uuid, uuid) to authenticated, service_role;


-- (B) Confirm Vault Payment & Create Investment
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

  select * into v_plan from public.vault_plans where id = v_pay.plan_id;
  if not found then
    raise exception 'Associated vault plan not found' using errcode = 'check_violation';
  end if;

  v_ends_at := now() + make_interval(days => v_plan.period_days);
  v_profit_minor := round(v_pay.amount_minor * (v_plan.daily_return_percent / 100.0) * v_plan.period_days);
  v_return_minor := v_pay.amount_minor + v_profit_minor;

  -- 1. Mark payment confirmed
  update public.vault_payments
     set status = 'confirmed',
         external_reference = coalesce(p_reference, external_reference),
         provider_payload = coalesce(p_payload, provider_payload),
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
  insert into public.notifications (user_id, kind, title, body, metadata)
  values (
    v_pay.user_id,
    'vault',
    'Vault Plan Activated',
    format('Your deposit of GHS %s in %s has started. It will mature on %s.',
           (v_pay.amount_minor::numeric / 100)::text,
           v_plan.name,
           to_char(v_ends_at, 'YYYY-MM-DD')),
    jsonb_build_object('investment_id', v_inv.id, 'plan_id', v_plan.id)
  );

  return v_inv;
end;
$$;

revoke execute on function public.confirm_vault_payment(uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_vault_payment(uuid, text, jsonb) to service_role;


-- (C) Claim Matured Vault Investment
create or replace function public.claim_vault_investment(p_investment_id uuid)
returns public.vault_investments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := (select auth.uid());
  v_inv     public.vault_investments;
  v_rate    bigint := public.config_int('points_per_currency_unit');
  v_points  bigint;
  v_entry   public.points_ledger;
begin
  select * into v_inv
    from public.vault_investments
   where id = p_investment_id
     for update;

  if not found then
    raise exception 'Vault investment not found' using errcode = 'check_violation';
  end if;

  if v_caller is not null and v_caller <> v_inv.user_id and not public.is_admin() then
    raise exception 'Not authorised to claim this vault' using errcode = 'insufficient_privilege';
  end if;

  if v_inv.status = 'claimed' then
    raise exception 'This vault payout has already been claimed' using errcode = 'check_violation';
  end if;

  if now() < v_inv.ends_at then
    raise exception 'This vault is still active and has not reached maturity date yet' using errcode = 'check_violation';
  end if;

  -- Convert expected return in minor currency units to points
  -- expected_return_minor is in pesewas (100 pesewas = 1 GHS)
  v_points := round((v_inv.expected_return_minor::numeric * v_rate::numeric) / 100.0);

  -- Credit points to user balance and ledger
  v_entry := public.credit_points(
    v_inv.user_id,
    v_points,
    'vault_payout',
    'vault_investment',
    v_inv.id::text,
    jsonb_build_object(
      'plan_name', v_inv.plan_name,
      'amount_minor', v_inv.amount_minor,
      'profit_minor', v_inv.expected_profit_minor,
      'period_days', v_inv.period_days,
      'daily_return_percent', v_inv.daily_return_percent
    )
  );

  -- Mark as claimed
  update public.vault_investments
     set status = 'claimed',
         claimed_at = now(),
         claimed_points = v_points,
         updated_at = now()
   where id = v_inv.id
   returning * into v_inv;

  -- Notify user
  insert into public.notifications (user_id, kind, title, body, metadata)
  values (
    v_inv.user_id,
    'vault',
    'Vault Return Claimed',
    format('You successfully claimed %s points (GHS %s) from your matured %s Vault!',
           v_points::text,
           (v_inv.expected_return_minor::numeric / 100)::text,
           v_inv.plan_name),
    jsonb_build_object('investment_id', v_inv.id, 'points', v_points)
  );

  return v_inv;
end;
$$;

revoke execute on function public.claim_vault_investment(uuid) from public, anon;
grant execute on function public.claim_vault_investment(uuid) to authenticated, service_role;


-- 8. Seed Default Vault Plans
insert into public.vault_plans (name, description, price_minor, period_days, daily_return_percent, sort_order)
values
  ('Starter Yield Vault', 'Lock for 14 days and earn 1.20% daily return on deposit.', 20000, 14, 1.20, 1),
  ('Growth Vault', 'Lock for 30 days and earn 1.80% daily return on deposit.', 50000, 30, 1.80, 2),
  ('Premier Wealth Vault', 'Lock for 60 days and earn 2.50% daily return on deposit.', 150000, 60, 2.50, 3)
on conflict do nothing;
