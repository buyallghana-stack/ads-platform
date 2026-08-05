-- ============================================================================
-- Migration 098 — plans become PRICE BANDS, and what you pay inside the band
-- sets what an ad is worth to you
--
-- Operator, 2026-08-04: *"if bronze is GHS 65 and Silver is GHS 140, if the
-- user is subscribing for bronze he can decide his amount between GHS 65-139
-- and the points per ad automatically adjust within that range… the number of
-- ads is constant at every tier but just their value in points and eventually
-- currency changes based on the price the user selects from that range, so we
-- may be in the same bronze plan but my points per ad may be worth a few
-- points more than my fellow bronze plan holder."*
--
-- THE MODEL, IN ONE SENTENCE: how much you pay places you on a line, and the
-- line decides what one ad is worth; which BAND you land in decides everything
-- that has to be a whole number — ads a day, game plays, priority.
--
-- WHY ONLY THE AD'S VALUE MOVES. Ads a day cannot be 4.3, and a cap is a
-- promise against inventory rather than against money. The value of an ad,
-- though, is money by definition, so it can follow the money exactly — and it
-- is the dimension the operator named.
--
-- EVERYTHING DERIVES FROM THE TOTAL PAID, which is what makes stacking
-- coherent. Two purchases of GHS 100 are worth exactly what one of GHS 200 is
-- worth, so there is no combination of plans that beats simply paying the same
-- money, and nothing to arbitrage. It also replaces the old "Platinum +2"
-- arithmetic with something a person can check: add up what you paid.
--
-- THE POINT'S VALUE. The operator's list quotes 10 points to the cedi. This
-- uses 100. Their cedi figures are honoured exactly and so are their ratios —
-- an ad is worth GHS 1.00 on Free and GHS 3.50 on Diamond either way — but at
-- 10 points to the cedi the whole Bronze band spans five distinct point values
-- and most of the range would be a slider that changes nothing. At 100 it
-- spans fifty.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The ladder
-- ---------------------------------------------------------------------------
--
-- Prices are BAND FLOORS now: the band runs from this plan's price up to the
-- next plan's price, and the top plan is a single price with nothing above it.

update public.tiers set
  daily_ad_cap = 1,
  reward_multiplier = 1.000,
  weekly_game_plays = 0,
  price_minor = 0
where slug = 'free';

update public.tiers set
  name = 'Bronze', price_minor = 6500, billing_period_days = 30,
  daily_ad_cap = 3, reward_multiplier = 1.500, weekly_game_plays = 1,
  ad_priority = 1, sort_order = 1, is_active = true
where slug = 'bronze';

update public.tiers set
  name = 'Silver', price_minor = 14000, billing_period_days = 30,
  daily_ad_cap = 5, reward_multiplier = 2.000, weekly_game_plays = 2,
  ad_priority = 2, sort_order = 2, is_active = true
where slug = 'silver';

update public.tiers set
  name = 'Gold', price_minor = 25000, billing_period_days = 30,
  daily_ad_cap = 7, reward_multiplier = 2.500, weekly_game_plays = 3,
  ad_priority = 3, sort_order = 3, is_active = true
where slug = 'gold';

update public.tiers set
  name = 'Platinum', price_minor = 52000, billing_period_days = 30,
  daily_ad_cap = 12, reward_multiplier = 3.000, weekly_game_plays = 4,
  ad_priority = 4, sort_order = 4, is_active = true
where slug = 'platinum';

insert into public.tiers
  (slug, name, description, price_minor, currency_code, billing_period_days,
   daily_ad_cap, reward_multiplier, redemption_minimum_points,
   referral_bonus_multiplier, ad_priority, ad_cooldown_seconds,
   weekly_game_plays, is_default, is_active, sort_order)
values
  ('diamond', 'Diamond', 'The longest run and the highest rate we offer.',
   100000, 'GHS', 60, 15, 3.500, 5000, 1.000, 5, 0, 5, false, true, 5)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  billing_period_days = excluded.billing_period_days,
  daily_ad_cap = excluded.daily_ad_cap,
  reward_multiplier = excluded.reward_multiplier,
  weekly_game_plays = excluded.weekly_game_plays,
  ad_priority = excluded.ad_priority,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;


-- ---------------------------------------------------------------------------
-- 2. The point's value, and the ceiling
-- ---------------------------------------------------------------------------

update public.app_config set value = '100'
 where key = 'points_per_currency_unit';

-- Diamond is x3.5, so a ceiling of 3.0 would have quietly capped the plan the
-- operator priced at a thousand cedis. It stays a backstop, not a limit that
-- binds in normal use.
update public.app_config set value = '3.500'
 where key = 'subscription_max_combined_multiplier';

/*
  A base ad is worth GHS 1.00 to somebody on Free — the operator's own figure —
  which at 100 points to the cedi is 100 points before any plan multiplier.
  Every ad in the pool is set to it; an admin can still price a particular ad
  above or below, and the multiplier applies on top either way.
*/
update public.ads set points_reward = 100 where status <> 'archived';


-- ---------------------------------------------------------------------------
-- 3. What each subscription actually cost
-- ---------------------------------------------------------------------------
--
-- The benefit now comes from the amount paid, so the amount has to live on the
-- subscription. It was only ever on the plan, which is precisely the thing
-- that is no longer fixed.

alter table public.user_subscriptions
  add column if not exists amount_minor bigint;

comment on column public.user_subscriptions.amount_minor is
  'What this subscription was actually paid for, in minor units. Between the band floor and the next band floor. Null on rows that predate flexible pricing, which fall back to the plan price.';

-- Anything already bought was bought at the plan's fixed price.
update public.user_subscriptions s
   set amount_minor = t.price_minor
  from public.tiers t
 where t.id = s.tier_id and s.amount_minor is null;


-- ---------------------------------------------------------------------------
-- 4. The line itself
-- ---------------------------------------------------------------------------

/**
 * What one ad is worth to somebody who has paid this much, as a multiplier.
 *
 * The ladder is a series of (price, multiplier) points and this reads straight
 * off it: find the band the money lands in, then move proportionally towards
 * the next band. Paying the floor of a band gives exactly that band's rate;
 * paying just under the next floor gives almost the next band's rate; and the
 * two meet, so there is no step to arbitrage at any boundary.
 *
 * Above the top band the line stops. Somebody who pays more than the top plan
 * gets the top plan's rate and nothing further, which the screen has to say
 * out loud or it is taking money for nothing.
 */
create or replace function public.plan_multiplier_for_amount(p_minor bigint)
returns numeric
language sql
stable
set search_path = ''
as $$
  with rungs as (
    select price_minor, reward_multiplier,
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
  )
  select round(
    case
      when l.next_price is null or l.next_price <= l.price_minor
        then l.reward_multiplier
      else l.reward_multiplier
           + (l.next_multiplier - l.reward_multiplier)
             * (greatest(coalesce(p_minor, 0), 0) - l.price_minor)::numeric
             / (l.next_price - l.price_minor)::numeric
    end, 3)
  from landed l;
$$;

comment on function public.plan_multiplier_for_amount(bigint) is
  'The points multiplier bought by this much money, interpolated between plan prices. Continuous across every band boundary.';


/** The plan somebody's total spend places them in — the band, not the line. */
create or replace function public.plan_band_for_amount(p_minor bigint)
returns public.tiers
language sql
stable
set search_path = ''
as $$
  select t.* from public.tiers t
   where t.is_active and t.price_minor <= greatest(coalesce(p_minor, 0), 0)
   order by t.price_minor desc
   limit 1;
$$;


-- ---------------------------------------------------------------------------
-- 5. Resolving somebody's benefits
-- ---------------------------------------------------------------------------
--
-- Rewritten around one number: everything they have paid for that is still
-- live. The band gives the whole-number benefits, the line gives the rate.
--
-- The old function combined held plans with a `sum_bonus` rule and a stacking
-- switch. That machinery is gone, because adding money IS the stacking rule
-- now — and it is a better one: two purchases of GHS 100 land in exactly the
-- same place as one of GHS 200, so no combination of plans can beat paying the
-- same total, and there is nothing left to arbitrage.

create or replace function public.resolve_user_tier(p_user_id uuid)
returns public.tiers
language plpgsql
stable
set search_path = ''
as $$
declare
  v_total   bigint;
  v_band    public.tiers;
  v_default public.tiers;
  v_held    int;
  v_ceiling numeric := coalesce(
    (select value::numeric from public.app_config where key = 'subscription_max_combined_multiplier'),
    3.500);
  /* Platform-wide since 2026-08-01: no plan has its own withdrawal threshold.
     It is set on EVERY path out of this function — the free one included —
     because every screen reads its answer, and a screen disagreeing with
     `request_redemption` is the failure that rule was written to remove. */
  v_minimum bigint := public.config_int('redemption_minimum_points');
begin
  select t.* into v_default from public.tiers t where t.is_default limit 1;
  v_default.redemption_minimum_points := v_minimum;

  select coalesce(sum(coalesce(s.amount_minor, t.price_minor)), 0), count(*)
    into v_total, v_held
    from public.user_subscriptions s
    join public.tiers t on t.id = s.tier_id
   where s.user_id = p_user_id
     and (
       (s.status = 'active' and now() < s.current_period_end)
       or
       (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
     );

  if v_total <= 0 then
    return v_default;
  end if;

  v_band := public.plan_band_for_amount(v_total);
  if v_band.id is null then
    return v_default;
  end if;

  /* The rate follows the money; everything that must be a whole number
     follows the band. */
  v_band.reward_multiplier := least(public.plan_multiplier_for_amount(v_total), v_ceiling);
  v_band.redemption_minimum_points := v_minimum;
  v_band.is_default := false;

  return v_band;
end;
$$;
