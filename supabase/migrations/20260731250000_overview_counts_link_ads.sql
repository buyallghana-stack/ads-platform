-- ============================================================================
-- Migration 092 — the overview counts link ads
--
-- `adsLive` counted every active ad in `total` but split it into videos and
-- surveys only, so from the moment a link ad went live the card read
-- "12 live · 8 videos · 2 surveys" and left two unaccounted for. A split that
-- does not add up to its own total is worse than no split.
--
-- Regenerated from the definition in migration 20260729150000, which is the
-- only one this function has ever had; one line added to the jsonb object.
-- ============================================================================

create or replace function public.admin_overview_metrics()
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
        'surveys', count(*) filter (where format = 'survey'),
        'links',   count(*) filter (where format = 'link')
      ) from public.ads where status = 'active'
    )
  );
end;
$$;

revoke execute on function public.admin_overview_metrics() from public, anon;
grant execute on function public.admin_overview_metrics() to authenticated, service_role;
