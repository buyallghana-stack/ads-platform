-- ============================================================================
-- Migration 236 — a vault deposit is money, and it belongs in the money screens
--
-- Operator, 2026-09-19: *"a paid money for vault doesn't appear in total
-- deposits and their traces cannot also be found in payments."*
--
-- Both true, and the same root cause. The Vault arrived in migration 213 and
-- moved onto the payment hub in 232, and every screen that counts money was
-- written before it: `admin_overview_metrics`, `admin_finance_statement` and
-- `admin_daily_money` all sum `subscription_payments` and
-- `advertiser_payments` and stop, and `admin_list_hub_payments` selects from
-- `subscription_payments` alone. So a real GHS 20 deposit that Paystack
-- settled, that this database recorded, and that started a live investment,
-- was invisible in every total and untraceable on the payments screen.
--
-- `admin_list_hub_flags` already knew: migration 232 gave `hub_inbound_events`
-- a `payment_kind` and taught the FLAGS view to resolve a buyer through either
-- table. The payments view beside it was never given the same treatment, which
-- is why a vault payment could be seen only when something went wrong with it.
--
-- ⚠️ SHOWN SEPARATELY, NOT BLENDED. Vault money is counted in the deposits
-- TOTAL, because the operator asked where their GHS 20 went and "in the total"
-- is the answer. But it keeps its own line beside subscriptions and
-- advertisers, because it is not the same kind of money: a subscription is
-- revenue, and a vault deposit is cash in with a contractual return attached
-- to it. A headline that silently folded the two together would make
-- deposits minus withdrawals look healthier than the business is.
--
-- ⚠️ THE BODIES BELOW WERE READ OUT OF THE LIVE DATABASE with
-- `pg_get_functiondef`, not retyped from the migration that first created
-- them. Commit 94b4c4e is the precedent, and the first draft of THIS migration
-- proved it again: `admin_overview_metrics` was rebuilt from
-- 20260731250000_overview_counts_link_ads.sql, which returns `net`,
-- `activePlans` and `pointsOutstanding`. The function actually running returns
-- `profit`, `liability`, `pendingPayouts` and `adsLive`, and measures a rolling
-- 30 days rather than a calendar month. Applying that draft would have replaced
-- a working overview with one whose every key the app fails to find. The
-- migration file is not the function.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The overview headline
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
    from public.subscription_payments where status = 'confirmed' and confirmed_at >= v_prev;

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
-- 2. The monthly statement
-- ---------------------------------------------------------------------------
--
-- The return type gains a column, so this is a drop and recreate.

drop function if exists public.admin_finance_statement(integer);

create function public.admin_finance_statement(p_months integer default 12)
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
-- 3. The daily chart
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
                    where s.status = 'confirmed'
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


-- ---------------------------------------------------------------------------
-- 4. The payments screen
-- ---------------------------------------------------------------------------
--
-- `tier_name` becomes `item_name` and a `payment_kind` arrives beside it,
-- because the column now holds a plan OR a vault plan and a name that says
-- "tier" for a vault row is the kind of small lie this screen exists to stop.
-- `status` widens to text: `subscription_payment_status` is an enum that
-- `vault_payments` does not use.

drop function if exists public.admin_list_hub_payments(integer);

create function public.admin_list_hub_payments(p_limit integer default 100)
returns table (
  id             uuid,
  payment_kind   text,
  user_id        uuid,
  person         text,
  email          text,
  item_name      text,
  amount_minor   bigint,
  currency_code  text,
  status         text,
  hub_reference  text,
  failure_reason text,
  created_at     timestamptz,
  confirmed_at   timestamptz,
  last_event     text,
  last_result    text,
  last_detail    text,
  last_event_at  timestamptz,
  event_count    integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  with paid as (
    select sp.id, 'subscription'::text as kind, sp.user_id, t.name as item,
           sp.amount_minor, sp.currency_code::text, sp.status::text,
           sp.external_reference, sp.failure_reason, sp.created_at, sp.confirmed_at
      from public.subscription_payments sp
      join public.tiers t on t.id = sp.tier_id
     where sp.external_reference is not null

    union all

    /* The half that was missing. Same columns, the vault's own tables, and
       the plan name comes from `vault_plans` rather than `tiers`. */
    select vp.id, 'vault'::text, vp.user_id, coalesce(pl.name, 'Vault'),
           vp.amount_minor, vp.currency_code::text, vp.status::text,
           vp.external_reference, vp.failure_reason, vp.created_at, vp.confirmed_at
      from public.vault_payments vp
      left join public.vault_plans pl on pl.id = vp.plan_id
     where vp.external_reference is not null
  )
  select
    paid.id,
    paid.kind,
    paid.user_id,
    pr.full_name,
    u.email::text,
    paid.item,
    paid.amount_minor,
    paid.currency_code,
    paid.status,
    paid.external_reference,
    paid.failure_reason,
    paid.created_at,
    paid.confirmed_at,
    last_event.event,
    last_event.result,
    last_event.detail,
    last_event.received_at,
    coalesce(counted.n, 0)::int
  from paid
  left join public.profiles pr on pr.id = paid.user_id
  left join auth.users u       on u.id = paid.user_id
  /* ⚠️ MATCHED ON KIND AS WELL AS ID. `hub_inbound_events.payment_id` became
     polymorphic in migration 232 and `payment_kind` says which table it points
     at. Joining on the id alone would attach a subscription's events to a
     vault payment that happened to share a uuid, which is not possible today
     and is not a thing to leave resting on that. */
  left join lateral (
    select e.event, e.result, e.detail, e.received_at
      from public.hub_inbound_events e
     where e.payment_id = paid.id and e.payment_kind = paid.kind
     order by e.received_at desc
     limit 1
  ) last_event on true
  left join lateral (
    select count(*) as n from public.hub_inbound_events e
     where e.payment_id = paid.id and e.payment_kind = paid.kind
  ) counted on true
  order by paid.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;

revoke execute on function public.admin_list_hub_payments(integer) from public, anon;
grant  execute on function public.admin_list_hub_payments(integer) to authenticated, service_role;
