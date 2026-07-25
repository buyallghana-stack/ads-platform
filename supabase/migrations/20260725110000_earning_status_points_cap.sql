-- ============================================================================
-- Migration 041 — get_user_earning_status reports the points ceiling
--
-- The ads tab needs to know that a user has hit per_user_daily_points_cap
-- BEFORE it offers them another ad, otherwise the only way to find out is to
-- watch one and be refused — a whole ad's attention spent for nothing.
--
-- The obvious shortcut was to read app_config from the page. It does not work,
-- and it fails SILENTLY, which is worse: app_config's select policy is
-- `is_public OR is_admin()` and this key is private, so the read returns null
-- for every ordinary user and the flag would have been permanently false. It
-- looked correct in testing only because the test account is an admin.
--
-- So the answer comes from here instead. This function is already SECURITY
-- DEFINER precisely because it reads private config (earning_paused_globally),
-- and it already carries the authorisation check that stops one user asking
-- about another. One more column costs nothing and cannot leak.
--
-- Return type changes, so it is dropped and recreated rather than replaced.
-- ============================================================================

drop function if exists public.get_user_earning_status(uuid);

create function public.get_user_earning_status(p_user_id uuid)
returns table (
  balance              bigint,
  tier_slug            text,
  tier_name            text,
  daily_ad_cap         int,
  ads_completed_today  int,
  ads_remaining_today  int,
  currency_value       numeric,
  earning_paused       boolean,
  account_disabled     boolean,
  points_earned_today  bigint,
  -- Ads left and points left are DIFFERENT limits, and stacking pulls them
  -- apart: a Platinum stack can have 190 ads of allowance remaining and still
  -- be unable to earn another point today.
  points_cap_reached   boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_cap    bigint := public.config_int('per_user_daily_points_cap');
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s earning status'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    coalesce(b.balance, 0),
    t.slug,
    t.name,
    t.daily_ad_cap,
    coalesce(c.ads_completed, 0),
    greatest(t.daily_ad_cap - coalesce(c.ads_completed, 0), 0),
    round(coalesce(b.balance, 0)::numeric
          / nullif(public.config_int('points_per_currency_unit'), 0), 2),
    public.config_bool('earning_paused_globally'),
    (select p.disabled_at is not null from public.profiles p where p.id = p_user_id),
    coalesce(c.points_earned, 0)::bigint,
    -- credit_points refuses a credit that would take the day's total PAST the
    -- cap, so sitting exactly on it already means the next ad pays nothing.
    (v_cap > 0 and coalesce(c.points_earned, 0) >= v_cap)
  from (select public.resolve_user_tier(p_user_id) as tier) r
  cross join lateral (select (r.tier).*) t
  left join public.user_balances b on b.user_id = p_user_id
  left join public.daily_earning_counters c
    on c.user_id = p_user_id and c.day = public.utc_today();
end;
$$;

comment on function public.get_user_earning_status(uuid) is
  'Balance, tier, cap progress, live cedi value and the per-user daily points ceiling in one round trip. Callers may only read their own status unless they are an admin; service_role is unrestricted.';

revoke execute on function public.get_user_earning_status(uuid) from public, anon;
grant execute on function public.get_user_earning_status(uuid) to authenticated, service_role;
