-- ============================================================================
-- Migration 239: a plan can be bought from the balance
--
-- Operator, 2026-09-25: *"users cannot buy a plan with their account balance
-- for a regular plan, the vault has this feature but plans dont, kindly add
-- it."* And on how it should read: it does not count towards the admin's total
-- deposits, it DOES count as a plan, and in the user's own history it looks
-- like a paid plan, the same as one bought through Paystack.
--
-- ⚠️ ONE PURCHASE PATH, NOT TWO. `purchase_plan_with_balance` does not grant a
-- plan itself. It opens the payment through `start_subscription_payment` and
-- grants it through `confirm_subscription_payment`, the same two functions a
-- Paystack purchase goes through. So the band check, the coupon, stacking,
-- renewal from the later end, the plan cap, the referral commission and the
-- free-days buyout trigger (migration 235) all behave exactly as they do for a
-- card payment, and there is no second copy of any of them to drift.
-- Neither function is redefined here; both are only called.
--
-- ⚠️ ALL OR NOTHING. The payment row, the coupon redemption, the points debit
-- and the plan are one transaction. A short balance, a plan cap or a refused
-- coupon raises and undoes every one of them, so nobody is left holding a
-- debited balance without a plan, or a plan without the debit.
--
-- WHAT IT COSTS. The amount actually charged (after any coupon) converted at
-- `points_per_currency_unit`, the same conversion `purchase_vault_with_balance`
-- uses. The debit is its own ledger type, `plan_purchase`, referencing the
-- payment row, so `points_ledger_source_once_idx` makes a double debit for one
-- payment impossible rather than unlikely.
--
-- ⚠️ NO EXTERNAL REFERENCE. The confirmed row carries `external_reference`
-- null. No money reached Paystack, so there is nothing for the hub to match,
-- and `admin_list_hub_payments` (which lists only rows with a reference) keeps
-- showing only payments that went through the hub.
--
-- ⚠️ NOT A DEPOSIT. No cash arrived, so the three screens that total deposits
-- leave `method = 'balance'` out. Counting it would make deposits minus
-- withdrawals look healthier than the bank account. The plan itself still
-- counts everywhere plans are counted, because the user really does hold it.
-- The three bodies below are migration 236's, which were read out of the live
-- database, with only that filter added.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, description, is_public)
values
  ('plan_balance_purchase_enabled', 'true', 'bool',
   'Whether users may buy a plan with their account balance instead of paying through Paystack. Off hides the option and refuses new balance purchases; plans already bought are unaffected.',
   false)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The purchase
-- ---------------------------------------------------------------------------

create or replace function public.purchase_plan_with_balance(
  p_user_id uuid,
  p_tier_id uuid,
  p_amount_minor bigint default null,
  p_coupon_code text default null
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay     public.subscription_payments;
  v_sub     public.user_subscriptions;
  v_tier    public.tiers;
  v_rate    bigint := public.config_int('points_per_currency_unit');
  v_points  bigint;
  v_balance bigint;
begin
  if p_user_id is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  if not coalesce(public.config_bool('plan_balance_purchase_enabled'), false) then
    raise exception 'Buying a plan with your balance is not available right now'
      using errcode = 'check_violation';
  end if;

  /* The band, the disabled account, the inactive plan and the coupon are all
     checked in here, exactly as for a Paystack purchase. */
  select * into v_pay
    from public.start_subscription_payment(
      p_user_id, p_tier_id, 'balance'::public.subscription_payment_method,
      p_amount_minor, p_coupon_code);

  v_points := round((v_pay.amount_minor::numeric * v_rate::numeric) / 100.0);

  select coalesce(balance, 0) into v_balance
    from public.user_balances where user_id = p_user_id;

  if coalesce(v_balance, 0) < v_points then
    raise exception 'Insufficient balance. You need % points (GHS %) for this plan, but have % points.',
      v_points::text,
      to_char(v_pay.amount_minor::numeric / 100.0, 'FM999,999,990.00'),
      coalesce(v_balance, 0)::text
      using errcode = 'check_violation';
  end if;

  select * into v_tier from public.tiers where id = p_tier_id;

  /* debit_points re-checks the balance inside its own UPDATE, so two
     purchases racing for the same points cannot both succeed. */
  perform public.debit_points(
    p_user_id,
    v_points,
    'plan_purchase',
    'subscription_payment',
    v_pay.id::text,
    jsonb_build_object(
      'payment_id', v_pay.id,
      'tier_id', p_tier_id,
      'plan_name', v_tier.name,
      'amount_minor', v_pay.amount_minor,
      'list_minor', v_pay.list_minor,
      'period_days', v_pay.period_days
    )
  );

  v_sub := public.confirm_subscription_payment(
    v_pay.id,
    null,
    jsonb_build_object('source', 'balance', 'points', v_points)
  );

  return v_sub;
end;
$$;

/* ⚠️ service_role only, like `start_subscription_payment`. The user id is a
   parameter, so a caller with any other role could spend somebody else's
   balance. The server action passes the verified session's id. */
revoke execute on function public.purchase_plan_with_balance(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant  execute on function public.purchase_plan_with_balance(uuid, uuid, bigint, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- 3. The overview headline: deposits leave balance purchases out
-- ---------------------------------------------------------------------------

create or replace function public.admin_overview_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_now      timestamptz := now();
  v_from     timestamptz := v_now - interval '30 days';
  v_prev     timestamptz := v_now - interval '60 days';
  v_rate     bigint      := greatest(public.config_int('points_per_currency_unit'), 1);

  v_subs      numeric; v_subs_prev      numeric;
  v_advs      numeric; v_advs_prev      numeric;
  v_vault     numeric; v_vault_prev     numeric;
  v_wdls      numeric; v_wdls_prev      numeric;
  v_users     bigint;  v_users_prev     bigint;
  v_new_today bigint;
  v_active    bigint;  v_active_prev    bigint;
  v_points    bigint;
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(amount_minor) filter (where confirmed_at >= v_from), 0)::numeric / 100,
         coalesce(sum(amount_minor) filter (where confirmed_at >= v_prev and confirmed_at < v_from), 0)::numeric / 100
    into v_subs, v_subs_prev
    from public.subscription_payments
   where status = 'confirmed' and confirmed_at >= v_prev
     /* A plan bought from the balance brought no cash in. Migration 239. */
     and method <> 'balance';

  select coalesce(sum(amount_minor) filter (where received_at >= v_from), 0)::numeric / 100,
         coalesce(sum(amount_minor) filter (where received_at >= v_prev and received_at < v_from), 0)::numeric / 100
    into v_advs, v_advs_prev
    from public.advertiser_payments where received_at >= v_prev;

  /* NEW. The same read as the subscriptions above, against the vault's own
     payments table. `confirmed` is the only status that means the money
     arrived, and `vault_payments` has no refunded state of its own. */
  select coalesce(sum(amount_minor) filter (where confirmed_at >= v_from), 0)::numeric / 100,
         coalesce(sum(amount_minor) filter (where confirmed_at >= v_prev and confirmed_at < v_from), 0)::numeric / 100
    into v_vault, v_vault_prev
    from public.vault_payments where status = 'confirmed' and confirmed_at >= v_prev;

  select coalesce(sum(currency_amount) filter (where paid_at >= v_from), 0),
         coalesce(sum(currency_amount) filter (where paid_at >= v_prev and paid_at < v_from), 0)
    into v_wdls, v_wdls_prev
    from public.redemptions where paid_at is not null and paid_at >= v_prev;

  -- Users counted as a RUNNING TOTAL at each point, not as signups per
  -- window: "users" on an overview means how many there are, and its trend
  -- means how much that grew. Deleted accounts are excluded from both ends so
  -- the comparison is like for like.
  select count(*) filter (where created_at <= v_now),
         count(*) filter (where created_at <= v_from),
         count(*) filter (where created_at >= date_trunc('day', v_now))
    into v_users, v_users_prev, v_new_today
    from public.profiles where deleted_at is null;

  select count(*) filter (where status = 'active'),
         count(*) filter (where started_at <= v_from
                            and (cancelled_at is null or cancelled_at > v_from)
                            and current_period_end > v_from)
    into v_active, v_active_prev
    from public.user_subscriptions;

  select coalesce(sum(balance), 0) into v_points from public.user_balances;

  return jsonb_build_object(
    'deposits', jsonb_build_object(
      'value', v_subs + v_advs + v_vault,
      'changePct', public.pct_change(v_subs + v_advs + v_vault,
                                     v_subs_prev + v_advs_prev + v_vault_prev),
      'subscriptions', v_subs,
      'advertisers', v_advs,
      'vault', v_vault
    ),
    'withdrawals', jsonb_build_object(
      'value', v_wdls,
      'changePct', public.pct_change(v_wdls, v_wdls_prev)
    ),
    'profit', jsonb_build_object(
      'value', (v_subs + v_advs + v_vault) - v_wdls,
      'changePct', public.pct_change((v_subs + v_advs + v_vault) - v_wdls,
                                     (v_subs_prev + v_advs_prev + v_vault_prev) - v_wdls_prev)
    ),
    'liability', jsonb_build_object(
      'points', v_points,
      'ghs', round(v_points::numeric / v_rate, 2)
    ),
    'users', jsonb_build_object(
      'value', v_users,
      'changePct', public.pct_change(v_users, v_users_prev),
      'newToday', v_new_today
    ),
    'subscriptions', jsonb_build_object(
      'value', v_active,
      'changePct', public.pct_change(v_active, v_active_prev),
      'active', v_active
    ),
    'pendingPayouts', (
      select jsonb_build_object('count', count(*), 'ghs', coalesce(sum(currency_amount), 0))
        from public.redemptions
       where status in ('pending_approval', 'held')
    ),
    'adsLive', (
      select jsonb_build_object(
        'total',   count(*),
        'videos',  count(*) filter (where format = 'video'),
        'surveys', count(*) filter (where format = 'survey'),
        'links',   count(*) filter (where format = 'link')
      ) from public.ads where status = 'active'
    )
  );
end;
$function$;

revoke execute on function public.admin_overview_metrics() from public, anon;
grant  execute on function public.admin_overview_metrics() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. The monthly statement
-- ---------------------------------------------------------------------------
--
-- Same return type as migration 236, so replaced rather than dropped.

create or replace function public.admin_finance_statement(p_months integer default 12)
returns table (
  month             text,
  subscriptions_ghs numeric,
  advertisers_ghs   numeric,
  vault_ghs         numeric,
  withdrawals_ghs   numeric
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_from timestamptz;
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  v_from := date_trunc('month', now()) - (greatest(coalesce(p_months, 12), 1) - 1) * interval '1 month';

  return query
  with months as (
    select date_trunc('month', s.confirmed_at) as m,
           sum(s.amount_minor)::numeric / 100  as subs,
           0::numeric                          as advs,
           0::numeric                          as vlt,
           0::numeric                          as wdls
      from public.subscription_payments s
     where s.status = 'confirmed' and s.confirmed_at >= v_from
       and s.method <> 'balance'
     group by 1

    union all

    select date_trunc('month', p.received_at),
           0, sum(p.amount_minor)::numeric / 100, 0, 0
      from public.advertiser_payments p
     where p.received_at >= v_from
     group by 1

    union all

    select date_trunc('month', v.confirmed_at),
           0, 0, sum(v.amount_minor)::numeric / 100, 0
      from public.vault_payments v
     where v.status = 'confirmed' and v.confirmed_at >= v_from
     group by 1

    union all

    select date_trunc('month', r.paid_at),
           0, 0, 0, sum(r.currency_amount)
      from public.redemptions r
     where r.paid_at is not null and r.paid_at >= v_from
     group by 1
  )
  select to_char(x.m, 'YYYY-MM'),
         sum(x.subs), sum(x.advs), sum(x.vlt), sum(x.wdls)
    from months x
   group by x.m
   order by x.m desc;
end;
$function$;

revoke execute on function public.admin_finance_statement(integer) from public, anon;
grant  execute on function public.admin_finance_statement(integer) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. The daily chart, which has to agree with the headline above it
-- ---------------------------------------------------------------------------

create or replace function public.admin_daily_money(p_days integer default 30)
returns table (day date, deposits numeric, withdrawals numeric)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_days int := least(greatest(coalesce(p_days, 30), 1), 180);
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select d.day::date,
         coalesce((select sum(s.amount_minor)::numeric / 100
                     from public.subscription_payments s
                    where s.status = 'confirmed' and s.method <> 'balance'
                      and s.confirmed_at >= d.day and s.confirmed_at < d.day + interval '1 day'), 0)
       + coalesce((select sum(p.amount_minor)::numeric / 100
                     from public.advertiser_payments p
                    where p.received_at >= d.day and p.received_at < d.day + interval '1 day'), 0)
       /* NEW, and it has to match the overview or the chart under a headline
          disagrees with the headline. */
       + coalesce((select sum(v.amount_minor)::numeric / 100
                     from public.vault_payments v
                    where v.status = 'confirmed'
                      and v.confirmed_at >= d.day and v.confirmed_at < d.day + interval '1 day'), 0),
         coalesce((select sum(r.currency_amount)
                     from public.redemptions r
                    where r.paid_at >= d.day and r.paid_at < d.day + interval '1 day'), 0)
    from generate_series(
           date_trunc('day', now()) - (v_days - 1) * interval '1 day',
           date_trunc('day', now()),
           interval '1 day') as d(day)
   order by d.day;
end;
$function$;

revoke execute on function public.admin_daily_money(integer) from public, anon;
grant  execute on function public.admin_daily_money(integer) to authenticated, service_role;
