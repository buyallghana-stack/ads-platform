-- ============================================================================
-- Migration 202 — get_user_earning_status sets remaining ads to 0 when trial is over
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_earning_status(p_user_id uuid)
 RETURNS TABLE(balance bigint, tier_slug text, tier_name text, daily_ad_cap integer, ads_completed_today integer, ads_remaining_today integer, currency_value numeric, earning_paused boolean, account_disabled boolean, points_earned_today bigint, points_cap_reached boolean, free_earning_ends_at timestamp with time zone, free_earning_over boolean, reward_multiplier numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_cap    bigint := public.config_int('per_user_daily_points_cap');
  v_days   int    := public.config_int('free_earning_days')::int;
  v_over   boolean;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s earning status'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(
    case
      when v_days > 0 and (public.resolve_user_tier(p_user_id)).is_default
        then (select now() > p.created_at + make_interval(days => v_days)
                from public.profiles p where p.id = p_user_id)
    end,
    false) into v_over;

  return query
  select
    coalesce(b.balance, 0),
    t.slug,
    t.name,
    case when v_over then 0 else t.daily_ad_cap end,
    coalesce(c.ads_completed, 0),
    case when v_over then 0 else greatest(t.daily_ad_cap - coalesce(c.ads_completed, 0), 0) end,
    round(coalesce(b.balance, 0)::numeric
          / nullif(public.config_int('points_per_currency_unit'), 0), 2),
    public.config_bool('earning_paused_globally'),
    (select p.disabled_at is not null from public.profiles p where p.id = p_user_id),
    coalesce(c.points_earned, 0)::bigint,
    (v_cap > 0 and coalesce(c.points_earned, 0) >= v_cap),
    case
      when v_days > 0 and t.is_default
        then (select p.created_at + make_interval(days => v_days)
                from public.profiles p where p.id = p_user_id)
    end,
    v_over,
    t.reward_multiplier
  from (select public.resolve_user_tier(p_user_id) as tier) r
  cross join lateral (select (r.tier).*) t
  left join public.user_balances b on b.user_id = p_user_id
  left join public.daily_earning_counters c
    on c.user_id = p_user_id and c.day = public.utc_today();
end;
$function$;

revoke execute on function public.get_user_earning_status(uuid) from public, anon;
grant execute on function public.get_user_earning_status(uuid) to authenticated, service_role;
