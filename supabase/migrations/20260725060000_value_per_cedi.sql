-- ============================================================================
-- Migration 037 — More money paid ALWAYS means more benefit
--
-- Operator requirement 2026-07-25: a user's benefits must follow the TOTAL sum
-- they paid, so nobody who spent more ends up behind someone who spent less.
-- Migration 036 fixed that for the earning rate. It was still false for the
-- daily ad cap:
--
--     Bronze + Silver   GHS  70  ->  75 ads/day
--     Gold alone        GHS 100  ->  70 ads/day
--
-- CAUSE: summing absolute caps counts the free allowance more than once.
-- Bronze's 30 is 20 free + 10 bought; Silver's 45 is 20 free + 25 bought.
-- Added together that is 75, which hands out the free 20 twice.
--
-- FIX, matching what 036 did for multipliers: count the free allowance once
-- and add what each plan actually buys.
--
--     Bronze + Silver  ->  20 + 10 + 25  =  55 ads/day
--
-- THE GUARANTEE. With that in place, every benefit is a straight line from the
-- money paid, provided each plan is priced at the same value per cedi. The
-- seeded plans are aligned to exactly that here:
--
--     every GHS 1 buys  +0.5 ads per day  and  +0.5% on the earning rate
--
--       Bronze    GHS  20  ->  +10 ads,  +10%   (x1.10)
--       Silver    GHS  50  ->  +25 ads,  +25%   (x1.25)
--       Gold      GHS 100  ->  +50 ads,  +50%   (x1.50)
--       Platinum  GHS 200  -> +100 ads, +100%   (x2.00)
--
-- Platinum moves from x1.75 to x2.00: at x1.75 it was the WORST value per cedi
-- of the four, which is the same unfairness this migration exists to remove.
--
-- Because both benefits are linear in price, ANY combination of plans lands at
-- exactly 20 + 0.5 x (total GHS) ads and 1 + 0.005 x (total GHS) rate. Two
-- users who spent the same get the same, and spending more always gets more,
-- with no combination to game.
--
-- KEEPING THE GUARANTEE: it holds only while every plan shares that value per
-- cedi. If the admin dashboard later sets a plan's benefits out of proportion
-- to its price, the ordering can break again. That rule belongs on the admin
-- plan editor when it is built.
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
         -- The free allowance once, plus what each plan actually buys.
         v_default.daily_ad_cap + sum(greatest(daily_ad_cap - v_default.daily_ad_cap, 0)),
         min(redemption_minimum_points),
         max(ad_priority),
         min(ad_cooldown_seconds),
         case
           when v_mode = 'sum_bonus' then 1 + sum(reward_multiplier - 1)
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


-- Align Platinum to the same value per cedi as the rest (it was the worst).
alter table public.tiers disable trigger trg_notify_new_tier;

update public.tiers
   set reward_multiplier         = 2.000,
       referral_bonus_multiplier = 2.000,
       description               = 'The highest limit and the best rate we offer.',
       updated_at                = now()
 where slug = 'platinum';

alter table public.tiers enable trigger trg_notify_new_tier;
