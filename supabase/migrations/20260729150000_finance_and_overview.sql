-- ============================================================================
-- Migration 056 — the money statement and the overview figures
--
-- Overview and Finance are the last two screens showing invented money. The
-- pieces to build them honestly have existed for a while — confirmed
-- subscription payments, paid redemptions, the points ledger — and migration
-- 055 supplied the one that was missing, advertiser receipts. Nothing here
-- stores a total: every figure is derived, every time, from the rows that
-- justify it.
--
-- ONE CONVENTION, STATED ONCE, BECAUSE THE TWO SIDES DISAGREE
-- Money IN is stored in MINOR units (`subscription_payments.amount_minor`,
-- `advertiser_payments.amount_minor` — integer pesewas, never a float).
-- Money OUT is stored in MAJOR units (`redemptions.currency_amount`, numeric
-- GHS), because the redemption pipeline was built that way. Both conversions
-- happen here and nowhere else, so no application code ever has to remember
-- which side of the books it is on.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The statement
-- ---------------------------------------------------------------------------
--
-- WHICH DATE EACH SIDE IS COUNTED ON, and why it is not `created_at`:
--   subscriptions   `confirmed_at` — when Paystack said the money was real.
--                   A pending row that never confirmed is not income.
--   advertisers     `received_at` — when the transfer landed, which is not
--                   when the operator keyed it in. Backdating is normal.
--   withdrawals     `paid_at` — when cash actually left. A request approved
--                   in one month and paid in the next belongs to the month it
--                   was paid, or the statement stops reconciling to a bank.
--
-- MONEY OUT IS `paid_at is not null`, NOT `status = 'paid'`. A DISPUTED payout
-- has been paid — disputing it records that the payment is contested and
-- deliberately moves no points either way (migration 049), so the cash is
-- gone exactly as much as before. Counting only `paid` would drop those rows
-- out of money-out the moment a dispute was raised, which makes profit climb
-- because something went wrong. `paid_at` is set once, when the money leaves,
-- and no later status changes it; statuses that never got paid never have it.
--
-- Months with no activity at all are omitted rather than emitted as zeros:
-- this platform has weeks of history, and padding the table to twelve rows of
-- nothing would make an empty business look like a failing one.

drop function if exists public.admin_finance_statement(int);

create function public.admin_finance_statement(p_months int default 12)
returns table (
  month             text,
  subscriptions_ghs numeric,
  advertisers_ghs   numeric,
  withdrawals_ghs   numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
           0::numeric                          as wdls
      from public.subscription_payments s
     where s.status = 'confirmed' and s.confirmed_at >= v_from
     group by 1

    union all

    select date_trunc('month', p.received_at),
           0, sum(p.amount_minor)::numeric / 100, 0
      from public.advertiser_payments p
     where p.received_at >= v_from
     group by 1

    union all

    select date_trunc('month', r.paid_at),
           0, 0, sum(r.currency_amount)
      from public.redemptions r
     where r.paid_at is not null and r.paid_at >= v_from
     group by 1
  )
  select to_char(x.m, 'YYYY-MM'),
         sum(x.subs), sum(x.advs), sum(x.wdls)
    from months x
   group by x.m
   order by x.m desc;
end;
$$;

comment on function public.admin_finance_statement(int) is
  'Monthly money in and out. Each side counted on the date the money actually moved — confirmed_at, received_at, paid_at — so the statement reconciles to a bank. Empty months are omitted, not zero-filled.';

revoke execute on function public.admin_finance_statement(int) from public, anon;
grant execute on function public.admin_finance_statement(int) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. The overview
-- ---------------------------------------------------------------------------
--
-- Every headline figure with the change against the PREVIOUS 30 DAYS, because
-- a number with no direction is a number nobody acts on.
--
-- THE TREND IS NULL, NOT ZERO, WHEN THERE IS NOTHING TO COMPARE TO. Going
-- from GHS 0 to GHS 300 is not "+100%" and it is not "no change" — it is a
-- comparison that cannot be made, and inventing a percentage for it is how a
-- first month of trading reads as a triumph or a disaster at random. The UI
-- shows nothing at all in that case.
--
-- LIABILITY IS THE ONE THAT IS NOT A FLOW. It is the standing balance of
-- points people hold and have not cashed, valued at the CURRENT rate — what
-- the platform owes if everybody redeemed tomorrow. It belongs beside profit
-- because profit read without it looks better than it is.

drop function if exists public.admin_overview_metrics();

create function public.admin_overview_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := now();
  v_from     timestamptz := v_now - interval '30 days';
  v_prev     timestamptz := v_now - interval '60 days';
  v_rate     bigint      := greatest(public.config_int('points_per_currency_unit'), 1);

  v_subs      numeric; v_subs_prev      numeric;
  v_advs      numeric; v_advs_prev      numeric;
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
      'value', v_subs + v_advs,
      'changePct', public.pct_change(v_subs + v_advs, v_subs_prev + v_advs_prev),
      'subscriptions', v_subs,
      'advertisers', v_advs
    ),
    'withdrawals', jsonb_build_object(
      'value', v_wdls,
      'changePct', public.pct_change(v_wdls, v_wdls_prev)
    ),
    'profit', jsonb_build_object(
      'value', (v_subs + v_advs) - v_wdls,
      'changePct', public.pct_change((v_subs + v_advs) - v_wdls,
                                     (v_subs_prev + v_advs_prev) - v_wdls_prev)
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
        'surveys', count(*) filter (where format = 'survey')
      ) from public.ads where status = 'active'
    )
  );
end;
$$;

comment on function public.admin_overview_metrics() is
  'Headline figures with their change against the previous 30 days. changePct is NULL when the earlier window was empty — a comparison that cannot be made must not be shown as a percentage.';

revoke execute on function public.admin_overview_metrics() from public, anon;
grant execute on function public.admin_overview_metrics() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. Percentage change, honestly
-- ---------------------------------------------------------------------------
--
-- Its own function because six figures need it and each one would otherwise
-- carry its own copy of the divide-by-zero decision. Returns NULL when there
-- is no previous value to compare against — see the note above.

create or replace function public.pct_change(p_now numeric, p_prev numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
           when p_prev is null or p_prev = 0 then null
           else round(((p_now - p_prev) / abs(p_prev)) * 100, 1)
         end;
$$;

revoke execute on function public.pct_change(numeric, numeric) from public, anon;
grant execute on function public.pct_change(numeric, numeric) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. The chart
-- ---------------------------------------------------------------------------
--
-- One row per day, money in against money out. Zero-filled across the whole
-- range here — unlike the statement, because a bar chart with days missing
-- draws a misleading shape: the gaps close up and a quiet week looks like a
-- busy one.
--
-- NOT RENDERED BELOW `md` (operator's rule: no charts on mobile), so this is
-- only ever fetched for a screen wide enough to draw it.

drop function if exists public.admin_daily_money(int);

create function public.admin_daily_money(p_days int default 30)
returns table (day date, deposits numeric, withdrawals numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
                    where p.received_at >= d.day and p.received_at < d.day + interval '1 day'), 0),
         coalesce((select sum(r.currency_amount)
                     from public.redemptions r
                    where r.paid_at >= d.day and r.paid_at < d.day + interval '1 day'), 0)
    from generate_series(
           date_trunc('day', now()) - (v_days - 1) * interval '1 day',
           date_trunc('day', now()),
           interval '1 day') as d(day)
   order by d.day;
end;
$$;

comment on function public.admin_daily_money(int) is
  'Daily money in against money out, zero-filled across the range — a bar chart with days missing closes the gaps and draws a quiet week as a busy one.';

revoke execute on function public.admin_daily_money(int) from public, anon;
grant execute on function public.admin_daily_money(int) to authenticated, service_role;
