-- ============================================================================
-- Migration 147 — the tier card says what the tier DOES
--
-- The dashboard's tier card showed a plan NAME and, underneath it, the daily
-- ad cap. Both are true and neither answers the question somebody who paid for
-- Gold actually has: what am I getting per ad?
--
-- The reward multiplier is that answer, and it is the one number the plan is
-- sold on. It was not on the screen because this function did not return it,
-- and the card fell back to the cap — which is already stated, in full, by the
-- "Ads today" card sitting immediately to its left.
--
-- WHY IT MUST COME FROM HERE and not from a `tiers` read in the app:
--
--   `resolve_user_tier` does not hand back a row from `tiers`. It resolves
--   STACKED subscriptions (migration 042): multipliers combine by the
--   configured mode — highest | sum | product — and are then clamped to
--   `subscription_max_combined_multiplier`. A user holding two plans has an
--   effective multiplier that appears in no single `tiers` row.
--
--   So an app-side `select reward_multiplier from tiers where slug = ...`
--   would show the wrong number to exactly the users who paid the most, and it
--   would be wrong silently. This function already holds the resolved record;
--   the value is one column away.
--
-- Additive: the column is appended, so every existing caller
-- (`/dashboard`, `/withdraw`, `/ads`) keeps reading the fields it names.
-- ============================================================================

drop function if exists public.get_user_earning_status(uuid);

create or replace function public.get_user_earning_status(p_user_id uuid)
 returns table(
   balance bigint,
   tier_slug text,
   tier_name text,
   daily_ad_cap integer,
   ads_completed_today integer,
   ads_remaining_today integer,
   currency_value numeric,
   earning_paused boolean,
   account_disabled boolean,
   points_earned_today bigint,
   points_cap_reached boolean,
   free_earning_ends_at timestamp with time zone,
   free_earning_over boolean,
   reward_multiplier numeric
 )
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_caller uuid := (select auth.uid());
  v_cap    bigint := public.config_int('per_user_daily_points_cap');
  v_days   int    := public.config_int('free_earning_days')::int;
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
    (v_cap > 0 and coalesce(c.points_earned, 0) >= v_cap),
    case
      when v_days > 0 and t.is_default
        then (select p.created_at + make_interval(days => v_days)
                from public.profiles p where p.id = p_user_id)
    end,
    coalesce(
      case
        when v_days > 0 and t.is_default
          then (select now() > p.created_at + make_interval(days => v_days)
                  from public.profiles p where p.id = p_user_id)
      end,
      false),
    /* Already stacked and already clamped by resolve_user_tier. */
    t.reward_multiplier
  from (select public.resolve_user_tier(p_user_id) as tier) r
  cross join lateral (select (r.tier).*) t
  left join public.user_balances b on b.user_id = p_user_id
  left join public.daily_earning_counters c
    on c.user_id = p_user_id and c.day = public.utc_today();
end;
$function$;

comment on function public.get_user_earning_status(uuid) is
  'One read for every earning screen. `reward_multiplier` is the RESOLVED, stacked, clamped multiplier from resolve_user_tier — never the raw column on a single tiers row.';

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC. Restore the intended
   grants explicitly; anon must not be able to read anybody's earning state. */
revoke execute on function public.get_user_earning_status(uuid) from public, anon;
grant  execute on function public.get_user_earning_status(uuid) to authenticated, service_role;
