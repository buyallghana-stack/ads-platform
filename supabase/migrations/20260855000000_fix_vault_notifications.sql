-- ============================================================================
-- Migration: 20260855000000_fix_vault_notifications.sql
-- Description: Fix notification dispatch across Vault functions to use
--              public.create_notification(p_user_id, p_type, p_title, p_body, p_reference)
-- ============================================================================

-- 1. purchase_vault_with_balance
create or replace function public.purchase_vault_with_balance(
  p_plan_id uuid,
  p_user_id uuid default null
)
returns public.vault_investments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller        uuid := coalesce(p_user_id, (select auth.uid()));
  v_plan          public.vault_plans;
  v_pay           public.vault_payments;
  v_inv           public.vault_investments;
  v_rate          bigint := public.config_int('points_per_currency_unit');
  v_points        bigint;
  v_user_balance  bigint;
  v_profit_minor  bigint;
  v_return_minor  bigint;
  v_ends_at       timestamptz;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  if not coalesce(public.config_bool('vault_enabled'), false) then
    raise exception 'Vault is currently closed for new deposits' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.vault_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'Vault plan not found or inactive' using errcode = 'check_violation';
  end if;

  -- Convert plan price in minor currency units to points (100 pesewas = 1 GHS)
  v_points := round((v_plan.price_minor::numeric * v_rate::numeric) / 100.0);

  -- Check user current points balance from public.user_balances
  select coalesce(balance, 0) into v_user_balance
    from public.user_balances
   where user_id = v_caller;

  if coalesce(v_user_balance, 0) < v_points then
    raise exception 'Insufficient balance. You need % points (GHS %) to purchase this plan, but have % points.',
      v_points::text,
      (v_plan.price_minor::numeric / 100)::text,
      coalesce(v_user_balance, 0)::text
      using errcode = 'check_violation';
  end if;

  -- 1. Deduct points from user balance
  perform public.debit_points(
    v_caller,
    v_points,
    'vault_deposit',
    'vault_plan',
    v_plan.id::text,
    jsonb_build_object(
      'plan_id', v_plan.id,
      'plan_name', v_plan.name,
      'price_minor', v_plan.price_minor,
      'period_days', v_plan.period_days,
      'daily_return_percent', v_plan.daily_return_percent
    )
  );

  -- 2. Create confirmed payment record
  insert into public.vault_payments (
    user_id, plan_id, amount_minor, currency_code, status, method,
    external_reference, confirmed_at
  )
  values (
    v_caller, v_plan.id, v_plan.price_minor, v_plan.currency_code, 'confirmed', 'balance',
    'BAL_' || replace(gen_random_uuid()::text, '-', ''), now()
  )
  returning * into v_pay;

  -- 3. Calculate returns and ends_at
  v_ends_at := now() + make_interval(days => v_plan.period_days);
  v_profit_minor := round(v_plan.price_minor * (v_plan.daily_return_percent / 100.0) * v_plan.period_days);
  v_return_minor := v_plan.price_minor + v_profit_minor;

  -- 4. Create active vault investment
  insert into public.vault_investments (
    user_id, plan_id, plan_name, amount_minor, currency_code,
    daily_return_percent, period_days, started_at, ends_at,
    status, expected_profit_minor, expected_return_minor, payment_id
  )
  values (
    v_caller, v_plan.id, v_plan.name, v_plan.price_minor, v_plan.currency_code,
    v_plan.daily_return_percent, v_plan.period_days, now(), v_ends_at,
    'active', v_profit_minor, v_return_minor, v_pay.id
  )
  returning * into v_inv;

  -- 5. Send notification using standard create_notification
  perform public.create_notification(
    v_caller,
    'announcement'::public.notification_type,
    'Vault Plan Activated',
    format('Your deposit of GHS %s in %s has started using your account balance. It will mature on %s.',
           (v_plan.price_minor::numeric / 100)::text,
           v_plan.name,
           to_char(v_ends_at, 'YYYY-MM-DD')),
    jsonb_build_object('investment_id', v_inv.id, 'plan_id', v_plan.id)
  );

  return v_inv;
end;
$$;

revoke execute on function public.purchase_vault_with_balance(uuid, uuid) from public, anon;
grant execute on function public.purchase_vault_with_balance(uuid, uuid) to authenticated, service_role;


-- 2. confirm_vault_payment
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
  perform public.create_notification(
    v_pay.user_id,
    'announcement'::public.notification_type,
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


-- 3. claim_vault_investment
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
  perform public.create_notification(
    v_inv.user_id,
    'payout'::public.notification_type,
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
