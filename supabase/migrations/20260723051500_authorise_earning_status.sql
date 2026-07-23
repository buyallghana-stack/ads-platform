-- ============================================================================
-- Migration 013 — Authorisation check on get_user_earning_status
--
-- Flagged by the security advisor. The function is SECURITY DEFINER, so it
-- bypasses RLS, and it takes p_user_id as an argument. Any signed-in user
-- could therefore call
--
--   POST /rest/v1/rpc/get_user_earning_status {"p_user_id": "<someone else>"}
--
-- and read that person's balance, tier, daily cap progress and cedi value.
-- Not catastrophic on its own, but it is other people's financial information
-- and it hands an attacker a way to find high-balance accounts to target.
--
-- Dropping to SECURITY INVOKER does not work: the function reads
-- earning_paused_globally, which is a private config key (is_public = false),
-- so config_bool() would raise for any non-admin caller. The definer rights
-- are needed; what was missing is a check on who is asking.
--
-- The guard reads auth.uid():
--   * a signed-in user may only ask about themselves, unless they are an admin
--   * service_role has no auth.uid(), so server-side calls pass unrestricted
-- ============================================================================

create or replace function public.get_user_earning_status(p_user_id uuid)
returns table (
  balance              bigint,
  tier_slug            text,
  tier_name            text,
  daily_ad_cap         int,
  ads_completed_today  int,
  ads_remaining_today  int,
  currency_value       numeric,
  earning_paused       boolean,
  account_disabled     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  -- A null caller means service_role or another server-side context, which is
  -- already trusted. A non-null caller must be the subject or an admin.
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
    (select p.disabled_at is not null from public.profiles p where p.id = p_user_id)
  from (select public.resolve_user_tier(p_user_id) as tier) r
  cross join lateral (select (r.tier).*) t
  left join public.user_balances b on b.user_id = p_user_id
  left join public.daily_earning_counters c
    on c.user_id = p_user_id and c.day = public.utc_today();
end;
$$;

comment on function public.get_user_earning_status(uuid) is
  'Balance, tier, cap progress and live cedi value in one round trip. Callers may only read their own status unless they are an admin; service_role is unrestricted.';

revoke execute on function public.get_user_earning_status(uuid) from public, anon;
