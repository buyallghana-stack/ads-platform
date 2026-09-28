-- Manual mobile money, part paid from the balance: plans AND the Vault.
--
-- Operator direction 2026-09-28: paying from the balance must work for plans
-- and the Vault, and when the balance does not reach the price the rest is
-- sent by hand, "as Paystack did". The operator confirms each one: DECLINE and
-- the points come back, ACCEPT and it is an ordinary purchase.
--
-- PLANS reuse migration 240 whole. `start_plan_topup_payment` takes the points
-- up front and `trg_plan_balance_hold` gives them back on pending -> failed.
-- The only change is that the row is marked `manual` instead of `paystack`.
--
-- THE VAULT had full balance purchases (`purchase_vault_with_balance`) but no
-- part-balance one. This adds migration 240's mechanism to `vault_payments`,
-- with ONE deliberate difference: `amount_minor` stays the FULL price, because
-- `confirm_vault_payment` builds the deposit (and its profit) from it, and it
-- is not rewritten here. The cash to send is `amount_minor - balance_minor`.

-- ---------------------------------------------------------------------------
-- 1. Plans: the part-balance checkout, marked manual
-- ---------------------------------------------------------------------------

create or replace function public.start_manual_plan_topup(
  p_user_id      uuid,
  p_tier_id      uuid,
  p_amount_minor bigint default null,
  p_coupon_code  text default null
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.subscription_payments;
begin
  -- Every check (balance switch, band, coupon, the hold itself) happens here.
  select * into v_pay
    from public.start_plan_topup_payment(p_user_id, p_tier_id, p_amount_minor, p_coupon_code);

  update public.subscription_payments
     set method = 'manual'
   where id = v_pay.id
  returning * into v_pay;

  return v_pay;
end;
$$;

revoke execute on function public.start_manual_plan_topup(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant  execute on function public.start_manual_plan_topup(uuid, uuid, bigint, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. The Vault: columns
-- ---------------------------------------------------------------------------

alter type public.ledger_entry_type add value if not exists 'vault_deposit_release';

alter table public.vault_payments
  add column if not exists balance_minor       bigint,
  add column if not exists balance_points      bigint,
  add column if not exists balance_held        boolean not null default false,
  add column if not exists manual_reference    text unique,
  add column if not exists manual_sender_phone text,
  add column if not exists manual_proof_path   text,
  add column if not exists manual_claimed_at   timestamptz;

alter table public.vault_payments
  drop constraint if exists vault_payments_balance_part_positive;
alter table public.vault_payments
  add constraint vault_payments_balance_part_positive
  check (
    (balance_minor is null and balance_points is null)
    or (balance_minor > 0 and balance_points > 0 and balance_minor < amount_minor)
  );

comment on column public.vault_payments.balance_minor is
  'Part of a manual Vault deposit paid from the balance. amount_minor stays the FULL deposit; the cash sent is amount_minor - balance_minor.';

-- ---------------------------------------------------------------------------
-- 3. The Vault: giving a hold back, and the trigger that keeps it in step
-- ---------------------------------------------------------------------------

create or replace function public.release_vault_balance_hold(
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

  -- The exact inverse of debit_points, as in release_plan_balance_hold.
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
    p_user_id, 'vault_deposit_release', p_points, v_new_balance,
    p_reference_type, p_payment_id::text,
    public.config_int('points_per_currency_unit'),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.release_vault_balance_hold(uuid, bigint, text, uuid, jsonb)
  from public, anon, authenticated;
grant  execute on function public.release_vault_balance_hold(uuid, bigint, text, uuid, jsonb)
  to service_role;

create or replace function public.vault_balance_hold_follows_status()
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

  -- Declined, or taken back: return the points.
  if new.status in ('failed', 'refunded') and old.balance_held then
    v_ref := case
      when exists (
        select 1 from public.points_ledger
         where user_id = new.user_id and entry_type = 'vault_deposit_release'
           and reference_type = 'vault_payment' and reference_id = new.id::text)
      then 'vault_payment_late'
      else 'vault_payment'
    end;
    perform public.release_vault_balance_hold(
      new.user_id, new.balance_points, v_ref, new.id,
      jsonb_build_object('payment_id', new.id, 'plan_id', new.plan_id,
                         'from_status', old.status, 'to_status', new.status));
    new.balance_held := false;
    return new;
  end if;

  -- Accepted after a decline had returned the points: take them again.
  if new.status = 'confirmed' and not old.balance_held then
    select coalesce(balance, 0) into v_balance
      from public.user_balances where user_id = new.user_id;
    if coalesce(v_balance, 0) >= new.balance_points then
      perform public.debit_points(
        new.user_id, new.balance_points, 'vault_deposit',
        'vault_payment_late', new.id::text,
        jsonb_build_object('payment_id', new.id, 'plan_id', new.plan_id,
                           'balance_minor', new.balance_minor, 'late', true));
      new.balance_held := true;
    else
      -- Never raise inside a confirmation.
      insert into public.system_alerts (severity, code, message, context)
      values ('warning', 'vault_balance_part_unrecovered',
              'A part-balance Vault deposit was confirmed after its points had been returned, and the buyer no longer had enough balance to take them again. The deposit was started.',
              jsonb_build_object('payment_id', new.id, 'user_id', new.user_id,
                                 'points_owed', new.balance_points,
                                 'balance_now', coalesce(v_balance, 0)));
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.vault_balance_hold_follows_status() from public, anon, authenticated;

drop trigger if exists trg_vault_balance_hold on public.vault_payments;
create trigger trg_vault_balance_hold
  before update of status on public.vault_payments
  for each row
  when (new.balance_points is not null)
  execute function public.vault_balance_hold_follows_status();

-- ---------------------------------------------------------------------------
-- 4. The Vault: starting a manual deposit, with or without the balance
-- ---------------------------------------------------------------------------

create or replace function public.start_manual_vault_payment(
  p_user_id     uuid,
  p_plan_id     uuid,
  p_use_balance boolean default false
)
returns public.vault_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay           public.vault_payments;
  v_rate          bigint := public.config_int('points_per_currency_unit');
  v_balance       bigint;
  v_balance_minor bigint;
  v_points        bigint;
begin
  if p_user_id is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  -- Vault switch, active plan, one active deposit per plan: all checked here.
  select * into v_pay from public.start_vault_payment(p_user_id, p_plan_id);

  update public.vault_payments set method = 'manual' where id = v_pay.id
  returning * into v_pay;

  if not p_use_balance then
    return v_pay;
  end if;

  select coalesce(balance, 0) into v_balance
    from public.user_balances where user_id = p_user_id
    for update;
  v_balance := coalesce(v_balance, 0);

  -- Rounded down, so the buyer is never charged a point more than the price.
  v_balance_minor := floor((v_balance::numeric * 100) / v_rate);
  v_points        := least(v_balance, round((v_balance_minor::numeric * v_rate) / 100.0)::bigint);

  if v_balance_minor >= v_pay.amount_minor then
    raise exception 'Your balance covers this deposit in full. Pay from your balance instead.'
      using errcode = 'check_violation';
  end if;
  if v_balance_minor <= 0 or v_points <= 0 then
    raise exception 'Your balance is empty, so there is nothing to put towards this deposit.'
      using errcode = 'check_violation';
  end if;

  update public.vault_payments
     set balance_minor  = v_balance_minor,
         balance_points = v_points,
         balance_held   = true
   where id = v_pay.id
  returning * into v_pay;

  perform public.debit_points(
    p_user_id, v_points, 'vault_deposit', 'vault_payment', v_pay.id::text,
    jsonb_build_object(
      'payment_id', v_pay.id,
      'plan_id', p_plan_id,
      'balance_minor', v_balance_minor,
      'cash_minor', v_pay.amount_minor - v_balance_minor,
      'split', true));

  return v_pay;
end;
$$;

revoke execute on function public.start_manual_vault_payment(uuid, uuid, boolean)
  from public, anon, authenticated;
grant  execute on function public.start_manual_vault_payment(uuid, uuid, boolean)
  to service_role;

create index if not exists vault_payments_manual_waiting_idx
  on public.vault_payments (manual_claimed_at)
  where manual_reference is not null and status = 'pending';
