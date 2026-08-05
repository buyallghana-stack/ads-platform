-- ============================================================================
-- Migration 100 — the plans list, told in bands
--
-- Since migration 098 a plan does not have a price, it has a RANGE, and what
-- somebody pays inside it decides what an ad is worth to them. The admin plans
-- screen was still built for a world of single prices: it showed "GHS 65" for
-- a plan that actually sells from GHS 65 to GHS 139, and it had no way to
-- answer the one question the whole feature exists to raise — *is anybody
-- paying above the floor?*
--
-- So this adds four columns:
--
--   band_max_ghs     the top of the range, from `plan_band_max_minor` — the
--                    same function the payment path validates against, so the
--                    screen cannot drift from the rule. NULL for the free
--                    plan, which is not sold, and for a hidden plan, which is
--                    not in the ladder at all.
--   paid_count       confirmed payments in the window, the denominator.
--   paid_above_floor how many of those were above the floor price. This is
--                    the number that says whether flexible pricing is earning
--                    its keep.
--   paid_avg_ghs     the average of what they actually paid.
--
-- Revenue already summed `subscription_payments.amount_minor`, so it was
-- correct the day bands shipped and is left exactly as it was.
--
-- The RETURN TYPE changes, so this is a drop and recreate rather than a
-- `create or replace`, and the body below is the one read back out of the live
-- database with `pg_get_functiondef` — retyping a SECURITY DEFINER function
-- from memory is how migration 081 lost three guards.
-- ============================================================================

drop function if exists public.admin_list_plans();

create function public.admin_list_plans()
returns table(
  id uuid,
  slug text,
  name text,
  description text,
  price_ghs numeric,
  band_max_ghs numeric,
  billing_period_days integer,
  daily_ad_cap integer,
  reward_multiplier numeric,
  redemption_minimum_points bigint,
  referral_bonus_multiplier numeric,
  ad_priority integer,
  ad_cooldown_seconds integer,
  is_default boolean,
  is_active boolean,
  sort_order integer,
  active integer,
  active_last_month integer,
  monthly_ghs numeric,
  paid_count integer,
  paid_above_floor integer,
  paid_avg_ghs numeric
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_then timestamptz := now() - interval '30 days';
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    t.id,
    t.slug,
    t.name,
    coalesce(t.description, ''),
    t.price_minor::numeric / 100,

    -- The ceiling, from the function the payment path itself validates
    -- against. Null where there is no band to speak of: the free plan is not
    -- sold, and a hidden plan is not in the ladder that the bands are cut
    -- from, so it has no neighbour to end against.
    case
      when t.is_default or not t.is_active then null
      else public.plan_band_max_minor(t.id)::numeric / 100
    end,

    t.billing_period_days,
    t.daily_ad_cap,
    t.reward_multiplier,
    t.redemption_minimum_points,
    t.referral_bonus_multiplier,
    t.ad_priority,
    t.ad_cooldown_seconds,
    t.is_default,
    t.is_active,
    t.sort_order,

    case when t.is_default then
      -- Everyone who holds no live paid plan. Deleted accounts excluded so it
      -- matches the user count on the overview.
      (select count(*)::int from public.profiles p
        where p.deleted_at is null
          and not exists (
            select 1 from public.user_subscriptions s
             where s.user_id = p.id and s.status in ('active', 'grace')))
    else
      (select count(*)::int from public.user_subscriptions s
        where s.tier_id = t.id and s.status in ('active', 'grace'))
    end,

    case when t.is_default then
      (select count(*)::int from public.profiles p
        where p.deleted_at is null
          and p.created_at <= v_then
          and not exists (
            select 1 from public.user_subscriptions s
             where s.user_id = p.id
               and s.started_at <= v_then
               and (s.cancelled_at is null or s.cancelled_at > v_then)
               and s.current_period_end > v_then))
    else
      (select count(*)::int from public.user_subscriptions s
        where s.tier_id = t.id
          and s.started_at <= v_then
          and (s.cancelled_at is null or s.cancelled_at > v_then)
          and s.current_period_end > v_then)
    end,

    -- What this plan actually brought in over the last thirty days. Confirmed
    -- payments only: a pending row that never cleared is not revenue.
    coalesce((select sum(sp.amount_minor)::numeric / 100
                from public.subscription_payments sp
               where sp.tier_id = t.id
                 and sp.status = 'confirmed'
                 and sp.confirmed_at >= v_then), 0),

    /* ---- What buyers chose inside the band ---------------------------
       One pass over the same confirmed payments. Strictly ABOVE the floor,
       not at or above it: everybody who takes the default is at the floor,
       and counting them would make every plan look like a success. */
    coalesce((select count(*)::int from public.subscription_payments sp
               where sp.tier_id = t.id
                 and sp.status = 'confirmed'
                 and sp.confirmed_at >= v_then), 0),

    coalesce((select count(*)::int from public.subscription_payments sp
               where sp.tier_id = t.id
                 and sp.status = 'confirmed'
                 and sp.confirmed_at >= v_then
                 and sp.amount_minor > t.price_minor), 0),

    -- Null rather than zero when nobody has bought: "no average" and "they
    -- paid nothing" are different things, and a zero would be graphed.
    (select round(avg(sp.amount_minor)::numeric / 100, 2)
       from public.subscription_payments sp
      where sp.tier_id = t.id
        and sp.status = 'confirmed'
        and sp.confirmed_at >= v_then)

  from public.tiers t
  order by t.sort_order, t.price_minor;
end;
$function$;

comment on function public.admin_list_plans() is
  'The plans with their band, their sales and what buyers actually chose to pay inside the band.';

-- The screen reads this through the caller''s own client, which is why the
-- function re-checks is_admin() for a non-null caller rather than trusting the
-- grant. Dropping the function dropped the grants with it.
grant execute on function public.admin_list_plans() to authenticated, service_role;
