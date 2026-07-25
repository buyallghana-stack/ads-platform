-- ============================================================================
-- Migration 036 — Stacked benefits ADD UP instead of the best one winning
--
-- Operator direction 2026-07-25: a user who paid for several plans must not
-- have the plans they paid for discarded. Keeping only the highest multiplier
-- could reasonably be read by the licensing body as taking money for a benefit
-- never delivered. Every plan a user holds now contributes.
--
-- HOW IT ADDS UP, and why not the obvious way. Summing the multipliers
-- themselves (1.10 + 1.25 = 2.35) produces this, on the seeded prices:
--
--     Bronze + Silver  GHS  70  ->  x2.35
--     Platinum alone   GHS 200  ->  x1.75
--
-- Paying nearly three times more would buy a WORSE rate, which is the very
-- unfairness this change exists to remove. So the default sums each plan's
-- BONUS above the free rate instead:
--
--     x1.10 and x1.25  ->  1 + 0.10 + 0.25  =  x1.35
--
-- Every plan still adds its full advertised benefit, nothing is thrown away,
-- and more money spent always means a better rate. Raw multiplier summing
-- remains available as a mode for the operator to choose.
--
-- Referral bonuses combine the same way. They were previously taken from the
-- user's top plan, which had the same "paid for, not delivered" problem.
-- ============================================================================

create or replace function public.resolve_user_tier(p_user_id uuid)
returns public.tiers
language plpgsql
stable
set search_path to ''
as $$
declare
  v_default   public.tiers;
  v_result    public.tiers;
  v_held      int;
  v_stacking  boolean;
  v_mode      text;
  v_max_mult  numeric;
  v_max_plans int;
  v_cap       int;
  v_mult      numeric;
  v_ref       numeric;
  v_min       bigint;
  v_priority  int;
  v_cooldown  int;
begin
  select t.* into v_default from public.tiers t where t.is_default limit 1;

  select coalesce((select value::boolean from public.app_config where key = 'subscription_stacking_enabled'), true),
         coalesce((select value from public.app_config where key = 'subscription_multiplier_combine_mode'), 'sum_bonus'),
         coalesce((select value::numeric from public.app_config where key = 'subscription_max_combined_multiplier'), 3.000),
         coalesce((select value::int from public.app_config where key = 'subscription_max_stacked_plans'), 4)
    into v_stacking, v_mode, v_max_mult, v_max_plans;

  select l.* into v_result
    from public.user_subscriptions s
    join public.tiers l on l.id = s.tier_id
   where s.user_id = p_user_id
     and (
       (s.status = 'active' and now() < s.current_period_end)
       or
       (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
     )
   order by l.sort_order desc
   limit 1;

  if v_result.id is null then
    return v_default;
  end if;

  if not v_stacking then
    return v_result;
  end if;

  with live as (
    select t.*
      from public.user_subscriptions s
      join public.tiers t on t.id = s.tier_id
     where s.user_id = p_user_id
       and (
         (s.status = 'active' and now() < s.current_period_end)
         or
         (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
       )
     order by t.sort_order desc
     limit greatest(v_max_plans, 1)
  )
  select count(*),
         sum(daily_ad_cap),
         min(redemption_minimum_points),
         max(ad_priority),
         min(ad_cooldown_seconds),
         case
           -- Default: each plan contributes its advantage over the free rate.
           when v_mode = 'sum_bonus' then 1 + sum(reward_multiplier - 1)
           -- Raw multiplier addition. Available, but note it can make two
           -- cheap plans beat one expensive one.
           when v_mode = 'sum'       then sum(reward_multiplier)
           when v_mode = 'product'   then exp(sum(ln(reward_multiplier)))
           else max(reward_multiplier)
         end,
         case
           when v_mode = 'highest' then max(referral_bonus_multiplier)
           else 1 + sum(referral_bonus_multiplier - 1)
         end
    into v_held, v_cap, v_min, v_priority, v_cooldown, v_mult, v_ref
    from live;

  -- The ceiling applies whatever the mode produced, and a stacked user can
  -- never be worse off than the free tier.
  v_mult := least(greatest(coalesce(v_mult, 1.000), v_default.reward_multiplier), v_max_mult);
  v_ref  := least(greatest(coalesce(v_ref, 1.000), v_default.referral_bonus_multiplier), v_max_mult);

  v_result.slug                      := 'combined';
  v_result.name                      := case when v_held > 1 then v_result.name || ' +' || (v_held - 1) else v_result.name end;
  v_result.daily_ad_cap              := coalesce(v_cap, v_default.daily_ad_cap);
  v_result.reward_multiplier         := v_mult;
  v_result.referral_bonus_multiplier := v_ref;
  v_result.redemption_minimum_points := coalesce(v_min, v_default.redemption_minimum_points);
  v_result.ad_priority               := coalesce(v_priority, 0);
  v_result.ad_cooldown_seconds       := coalesce(v_cooldown, 0);
  v_result.is_default                := false;

  return v_result;
end;
$$;


-- Switch the platform over, and lift the ceiling clear of what the current
-- plans can reach (all four = x2.60) so it never silently trims a paying
-- user. It stays in place as a guard if new plans are added later.
update public.app_config
   set value = 'sum_bonus',
       description = 'How reward and referral multipliers combine across stacked plans: sum_bonus (each plan adds its bonus above the free rate — the fair default) | sum (adds raw multipliers; can make two cheap plans beat one expensive plan) | product | highest.'
 where key = 'subscription_multiplier_combine_mode';

update public.app_config
   set value = '3.000',
       description = 'Hard ceiling on the combined multiplier, whatever the combine mode produces. Set above what the current plans can reach so it never trims a paying user; it exists to catch runaway configurations.'
 where key = 'subscription_max_combined_multiplier';
