-- ============================================================================
-- Migration: 20260856000000_vault_prevent_duplicate_active_purchases.sql
-- Description: Prevent users from purchasing a Vault plan they already have active.
-- ============================================================================

-- 1. Update start_vault_payment
create or replace function public.start_vault_payment(
  p_user_id uuid,
  p_plan_id uuid
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

  -- Disallow purchasing if user already holds an active investment in this plan
  if exists (
    select 1 from public.vault_investments
     where user_id = p_user_id
       and plan_id = p_plan_id
       and status = 'active'
  ) then
    raise exception 'You already have an active deposit in this Vault plan. Please wait until maturity to lock again.'
      using errcode = 'check_violation';
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


-- 2. Update purchase_vault_with_balance
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

  -- Disallow purchasing if user already holds an active investment in this plan
  if exists (
    select 1 from public.vault_investments
     where user_id = v_caller
       and plan_id = p_plan_id
       and status = 'active'
  ) then
    raise exception 'You already have an active deposit in this Vault plan. Please wait until maturity to lock again.'
      using errcode = 'check_violation';
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
