-- ============================================================================
-- Migration 102 — the top plan gets a band, and the safety ceiling stops
--                 trimming the people who paid the most
--
-- Operator, 2026-08-05: *"make the platinum plan a range of GHS 520–GHS 1000,
-- that's why i deleted the diamond plan."*
--
-- WHY THIS NEEDS A COLUMN AND NOT JUST A PRICE. Every band is cut against the
-- plan ABOVE it — `lead(price_minor) over (order by sort_order)` — so the top
-- rung has never had a ceiling to interpolate towards, and migration 098 made
-- that explicit: the top plan is one exact price, because "flexible" with
-- nothing above it would be taking money for nothing.
--
-- Deleting Diamond did not free its price for Platinum to grow into; it left
-- Platinum at the top of the ladder, sold at one figure. Giving the top rung a
-- range means telling the ladder where its line ENDS, which is exactly what
-- the deleted rung used to say. So the top plan now carries the two numbers
-- that rung carried:
--
--   band_max_minor        the most somebody may pay for it
--   band_max_multiplier   what they earn at if they pay it
--
-- Both are null on every other plan, where the rung above still answers both
-- questions. They are a description of a LINE END, not a second price list.
--
-- THE RATE AT THE TOP IS ×7.000, AND IT IS NOT INVENTED. This ladder is
-- exactly `1 + 0.006 × price` at every rung the operator set — 65→1.39,
-- 140→1.84, 250→2.50, 520→4.12 — and they had set Diamond to ×7.000 at GHS
-- 1000 eight minutes before deleting it. The same calculation, continued to
-- the same place.
--
-- ---------------------------------------------------------------------------
-- AND THE BUG THIS UNCOVERED, WHICH IS LIVE RIGHT NOW
--
-- `resolve_user_tier` ends with `least(plan_multiplier_for_amount(total),
-- subscription_max_combined_multiplier)`, and that config key is **3.500**
-- while Platinum's own rate is ×4.120. Every Platinum holder is being paid at
-- ×3.5 today — anybody who has paid more than about GHS 417 is silently
-- trimmed, and the plan screen promises the untrimmed figure.
--
-- The key's own description says it should sit above what the plans can reach
-- ("so it never trims a paying user; it exists to catch runaway
-- configurations"), so it is raised to ×10.000 here: clear of the new top of
-- the ladder by a wide margin, still low enough to catch a fat-fingered ×100.
-- Left at 3.500 the whole of this migration would be invisible — the band
-- would resolve to ×7 and then be clamped straight back to ×3.5.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Where the line ends
-- ---------------------------------------------------------------------------

alter table public.tiers
  add column if not exists band_max_minor bigint,
  add column if not exists band_max_multiplier numeric(6,3);

comment on column public.tiers.band_max_minor is
  'Top of this plan''s band, for the TOP rung only — the most somebody may pay for it. Null everywhere else, where the plan above sets the ceiling.';
comment on column public.tiers.band_max_multiplier is
  'The multiplier reached at band_max_minor. Null unless band_max_minor is set; together they are the line end the rung above would otherwise provide.';

/* Both or neither: a ceiling with no rate to interpolate towards is a band
   that cannot be priced, and a rate with no ceiling is a number nothing
   reads. */
alter table public.tiers
  drop constraint if exists tiers_band_top_pair,
  add constraint tiers_band_top_pair
    check ((band_max_minor is null) = (band_max_multiplier is null));

/* A ceiling at or below the floor is the empty band the admin screen warns
   about, except unrepresentable rather than merely flagged. */
alter table public.tiers
  drop constraint if exists tiers_band_top_above_price,
  add constraint tiers_band_top_above_price
    check (band_max_minor is null or band_max_minor > price_minor);

/* Paying more must never earn less. The screen warns about an inversion
   between two rungs; inside one rung it is refused outright, because there is
   no operator intent it could express. */
alter table public.tiers
  drop constraint if exists tiers_band_top_rate,
  add constraint tiers_band_top_rate
    check (band_max_multiplier is null or band_max_multiplier >= reward_multiplier);


-- ---------------------------------------------------------------------------
-- 2. The most somebody may pay
-- ---------------------------------------------------------------------------
--
-- The plan above still wins wherever there is one. The explicit ceiling only
-- answers for the rung that has nothing above it — so a plan can never be
-- given a ceiling that overlaps the plan above by setting a column.

create or replace function public.plan_band_max_minor(p_tier_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  with rungs as (
    select id, price_minor, band_max_minor,
           lead(price_minor) over (order by sort_order) as next_price
      from public.tiers
     where is_active
  )
  select case
           when r.next_price is not null then r.next_price - 1
           else coalesce(r.band_max_minor, r.price_minor)
         end
    from rungs r
   where r.id = p_tier_id;
$$;

comment on function public.plan_band_max_minor(uuid) is
  'The most somebody may pay for this plan: one pesewa under the plan above, or the top plan''s own band ceiling, or its price when it has neither.';


-- ---------------------------------------------------------------------------
-- 3. What that money buys
-- ---------------------------------------------------------------------------
--
-- One change of substance: where the line ends is now
-- `coalesce(next_price, band_max_minor)` rather than `next_price` alone.
--
-- AND THE AMOUNT IS CLAMPED TO THE CEILING, which the old body never had to
-- do. Below the top rung it is impossible to be over a band's ceiling — pay
-- more and you land on the next rung instead — so nothing stopped the
-- arithmetic running past the end of the line. The top rung has no next rung
-- to catch the overflow, so without `least(...)` somebody paying GHS 5,000
-- would extrapolate to ×31 and the ladder would have no top at all.
--
-- The boundary arithmetic is deliberately NOT symmetric, and this is the part
-- to be careful with when reading it:
--
--   between two rungs   the band ends one pesewa BELOW the next price, so the
--                       top of the band pays just under the next rung's rate
--                       and the two bands meet without a step.
--   at the top rung     the band ends ON the ceiling, so paying the ceiling
--                       pays exactly `band_max_multiplier`. There is no rung
--                       above to hand off to, so the last pesewa is ours.

create or replace function public.plan_multiplier_for_amount(p_minor bigint)
returns numeric
language sql
stable
set search_path = ''
as $$
  with rungs as (
    select price_minor, reward_multiplier, band_max_minor, band_max_multiplier,
           lead(price_minor)       over (order by sort_order) as next_price,
           lead(reward_multiplier) over (order by sort_order) as next_multiplier
      from public.tiers
     where is_active
  ),
  landed as (
    select * from rungs
     where price_minor <= greatest(coalesce(p_minor, 0), 0)
     order by price_minor desc
     limit 1
  ),
  line as (
    select l.price_minor,
           l.reward_multiplier,
           coalesce(l.next_price, l.band_max_minor)           as end_price,
           coalesce(l.next_multiplier, l.band_max_multiplier) as end_multiplier,
           -- Never past the end of the line. Only the top rung can be here.
           least(
             greatest(coalesce(p_minor, 0), 0),
             coalesce(l.next_price, l.band_max_minor, l.price_minor)
           ) as paid
      from landed l
  )
  select round(
    case
      when line.end_price is null or line.end_price <= line.price_minor
        then line.reward_multiplier
      else line.reward_multiplier
           + (line.end_multiplier - line.reward_multiplier)
             * (line.paid - line.price_minor)::numeric
             / (line.end_price - line.price_minor)::numeric
    end, 3)
  from line;
$$;

comment on function public.plan_multiplier_for_amount(bigint) is
  'The points multiplier bought by this much money, interpolated between plan prices. Continuous across every band boundary, and flat above the top plan''s ceiling.';


-- ---------------------------------------------------------------------------
-- 4. Platinum, and the ceiling that was trimming it
-- ---------------------------------------------------------------------------

update public.tiers
   set band_max_minor      = 100000,   -- GHS 1,000
       band_max_multiplier = 7.000     -- 1 + 0.006 × 1000, the ladder's own line
 where slug = 'platinum';

/* Raised from 3.500, which sat BELOW Platinum's own ×4.120 and was quietly
   paying every Platinum holder less than their plan advertised. */
update public.app_config
   set value = '10.000'
 where key = 'subscription_max_combined_multiplier';


-- ---------------------------------------------------------------------------
-- 5. The operator sets it, not a migration
-- ---------------------------------------------------------------------------
--
-- The whole point of the admin plans screen is that pricing is theirs to
-- change without waiting for a deploy, and a ceiling that only a migration can
-- move is a price fixed in code by another name.
--
-- `p_plan ? 'key'` — KEY PRESENT — rather than the `coalesce(new, old)` every
-- other field uses. Coalesce cannot express "clear this": sending null to
-- remove a ceiling would read as "leave it alone" and the top plan could never
-- go back to a single price once it had a range.

create or replace function public.admin_save_plan(p_admin_id uuid, p_plan jsonb)
returns public.tiers
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id   uuid := nullif(p_plan ->> 'id', '')::uuid;
  v_slug text := lower(trim(coalesce(p_plan ->> 'slug', '')));
  v_out  public.tiers;
  v_existing public.tiers;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    if v_slug !~ '^[a-z][a-z0-9_-]*$' then
      raise exception 'A plan needs a short name in lowercase letters, like "gold"'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.tiers t where t.slug = v_slug) then
      raise exception 'There is already a plan called %', v_slug using errcode = 'check_violation';
    end if;

    insert into public.tiers (
      slug, name, description, price_minor, billing_period_days, daily_ad_cap,
      reward_multiplier, redemption_minimum_points, referral_bonus_multiplier,
      ad_priority, ad_cooldown_seconds, is_active, sort_order,
      band_max_minor, band_max_multiplier
    ) values (
      v_slug,
      trim(coalesce(p_plan ->> 'name', '')),
      nullif(trim(coalesce(p_plan ->> 'description', '')), ''),
      round((p_plan ->> 'priceGhs')::numeric * 100),
      coalesce((p_plan ->> 'billingPeriodDays')::int, 30),
      coalesce((p_plan ->> 'dailyAdCap')::int, 0),
      coalesce((p_plan ->> 'rewardMultiplier')::numeric, 1),
      coalesce((p_plan ->> 'redemptionMinimumPoints')::bigint, 0),
      coalesce((p_plan ->> 'referralBonusMultiplier')::numeric, 1),
      coalesce((p_plan ->> 'adPriority')::int, 0),
      coalesce((p_plan ->> 'adCooldownSeconds')::int, 0),
      coalesce((p_plan ->> 'isActive')::boolean, true),
      -- `nullif(..., 0)` and not a plain coalesce: the editor sends 0 for a
      -- plan it has no position for yet, and taking that literally puts a new
      -- paid plan level with the free tier at the top of the ladder. An
      -- explicit 0 is only meaningful for the starting plan, which already
      -- exists and is never created here.
      coalesce(nullif((p_plan ->> 'sortOrder')::int, 0),
               (select coalesce(max(t.sort_order), 0) + 1 from public.tiers t)),
      round(nullif(p_plan ->> 'bandMaxGhs', '')::numeric * 100),
      nullif(p_plan ->> 'bandMaxMultiplier', '')::numeric
    )
    returning * into v_out;

    return v_out;
  end if;

  select * into v_existing from public.tiers where id = v_id;
  if not found then
    raise exception 'Unknown plan' using errcode = 'check_violation';
  end if;

  if v_slug <> '' and v_slug <> v_existing.slug then
    raise exception 'A plan''s short name cannot be changed once it exists'
      using errcode = 'check_violation';
  end if;

  -- The default tier must stay free. The table constraint says so too; this
  -- says it in a sentence, before the constraint says it in a stack trace.
  if v_existing.is_default and round((p_plan ->> 'priceGhs')::numeric * 100) <> 0 then
    raise exception 'The starting plan must stay free — everybody is on it without paying'
      using errcode = 'check_violation';
  end if;

  update public.tiers set
    name                      = trim(coalesce(p_plan ->> 'name', name)),
    description               = nullif(trim(coalesce(p_plan ->> 'description', '')), ''),
    price_minor               = round(coalesce((p_plan ->> 'priceGhs')::numeric * 100, price_minor)),
    billing_period_days       = coalesce((p_plan ->> 'billingPeriodDays')::int, billing_period_days),
    daily_ad_cap              = coalesce((p_plan ->> 'dailyAdCap')::int, daily_ad_cap),
    reward_multiplier         = coalesce((p_plan ->> 'rewardMultiplier')::numeric, reward_multiplier),
    redemption_minimum_points = coalesce((p_plan ->> 'redemptionMinimumPoints')::bigint, redemption_minimum_points),
    referral_bonus_multiplier = coalesce((p_plan ->> 'referralBonusMultiplier')::numeric, referral_bonus_multiplier),
    ad_priority               = coalesce((p_plan ->> 'adPriority')::int, ad_priority),
    ad_cooldown_seconds       = coalesce((p_plan ->> 'adCooldownSeconds')::int, ad_cooldown_seconds),
    sort_order                = coalesce((p_plan ->> 'sortOrder')::int, sort_order),
    band_max_minor            = case when p_plan ? 'bandMaxGhs'
                                     then round(nullif(p_plan ->> 'bandMaxGhs', '')::numeric * 100)
                                     else band_max_minor end,
    band_max_multiplier       = case when p_plan ? 'bandMaxMultiplier'
                                     then nullif(p_plan ->> 'bandMaxMultiplier', '')::numeric
                                     else band_max_multiplier end,
    updated_at                = now()
  where id = v_id
  returning * into v_out;

  return v_out;
end;
$function$;

/* `create or replace` does NOT restate an ACL, and this one moves money by
   changing what every holder earns. Said again rather than assumed — migration
   066 is the precedent for it being forgotten. */
revoke execute on function public.admin_save_plan(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_plan(uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 6. …and sees it on the screen
-- ---------------------------------------------------------------------------
--
-- `band_max_ghs` already reads through `plan_band_max_minor`, so the plans
-- LIST tells the truth about Platinum's new range without touching it. What is
-- missing is the rate at the top of that band — the editor cannot offer a
-- field for a number it was never sent.
--
-- The return type changes, so this is a drop and recreate; the body is the one
-- read back out of the live database with `pg_get_functiondef`.

drop function if exists public.admin_list_plans();

create function public.admin_list_plans()
returns table(
  id uuid,
  slug text,
  name text,
  description text,
  price_ghs numeric,
  band_max_ghs numeric,
  own_band_max_ghs numeric,
  own_band_max_multiplier numeric,
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

    /* The plan's OWN stored ceiling, which is a different question from the
       one above: that one is derived and every sold plan has an answer, these
       are set by hand and only the top rung has them. The editor needs the
       STORED values to fill its fields — offering to save a derived number
       would give a plan a ceiling it never had, and pin the middle of the
       ladder to a figure the database ignores. */
    t.band_max_minor::numeric / 100,
    t.band_max_multiplier,

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

-- Dropping the function dropped the grants with it.
grant execute on function public.admin_list_plans() to authenticated, service_role;
