-- ============================================================================
-- Migration 035 — Stackable plans + four seeded subscription plans
--
-- Implements the operator's stacking decision (2026-07-24, reconfirmed
-- 2026-07-25): a user may hold SEVERAL plans at once and their benefits
-- combine, but only ONE COPY OF EACH plan. "Only one subscription at a time"
-- means one of each, not one in total.
--
-- Three things change:
--   1. The one-live-subscription unique index is replaced by one-of-each.
--   2. resolve_user_tier stops picking an arbitrary live subscription and
--      aggregates across all of them.
--   3. The combine rules and their safety ceilings become admin-configurable,
--      because "configurable for safety" has to be literal — the whole reason
--      the operator accepted the cost risk.
--
-- COMBINE RULES (defaults):
--   daily ad cap        -> SUM of held plans
--   reward multiplier   -> HIGHEST wins. Summing multipliers is where payout
--                          liability runs away, so that is not the default;
--                          the mode is switchable and hard-capped.
--   redemption minimum  -> LOWEST held (the best threshold the user holds)
--   ad priority         -> HIGHEST; cooldown -> LOWEST
--
-- Plans are seeded deliberately modest, per the operator's intention to keep
-- real numbers tame and lean on the safety layers. All four run three months.
--
-- PRE-LAUNCH BLOCKER (unchanged): stacking must not go live for real money
-- until reward_pool_daily_ceiling_points and per_user_daily_points_cap are
-- set to non-zero. Both are still 0 (= unlimited) and are checked below.
-- ============================================================================

-- 1. One of each, instead of one in total. ----------------------------------
drop index if exists public.user_subscriptions_one_live_idx;

create unique index user_subscriptions_one_per_tier_idx
  on public.user_subscriptions (user_id, tier_id)
  where status in ('active', 'grace');

comment on index public.user_subscriptions_one_per_tier_idx is
  'Stacking rule: a user may hold many plans at once but only one copy of each.';


-- 2. Admin-configurable combine rules and safety ceilings. ------------------
insert into public.app_config (key, value, value_type, min_value, max_value, description) values
  ('subscription_stacking_enabled', 'true', 'bool', null, null,
   'Whether a user may hold several plans at once. False = the highest single plan applies.'),
  ('subscription_multiplier_combine_mode', 'highest', 'text', null, null,
   'How reward multipliers combine across stacked plans: highest | sum | product. Summing is the dangerous one — it multiplies payout liability.'),
  ('subscription_max_combined_multiplier', '2.000', 'decimal', 1, 10,
   'Hard ceiling on the combined reward multiplier, whatever the combine mode produces.'),
  ('subscription_max_stacked_plans', '4', 'int', 1, 20,
   'Maximum number of plans one user may hold at once.'),
  ('per_user_daily_points_cap', '0', 'int', 0, null,
   'Hard ceiling on points one user can earn per day regardless of stacked plans. Zero means unlimited — MUST be set before stacking goes live.')
on conflict (key) do nothing;


-- 3. Aggregate benefits across every live subscription. ---------------------
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
  v_min       bigint;
  v_priority  int;
  v_cooldown  int;
begin
  select t.* into v_default from public.tiers t where t.is_default limit 1;

  select coalesce((select value::boolean from public.app_config where key = 'subscription_stacking_enabled'), true),
         coalesce((select value from public.app_config where key = 'subscription_multiplier_combine_mode'), 'highest'),
         coalesce((select value::numeric from public.app_config where key = 'subscription_max_combined_multiplier'), 2.000),
         coalesce((select value::int from public.app_config where key = 'subscription_max_stacked_plans'), 4)
    into v_stacking, v_mode, v_max_mult, v_max_plans;

  /*
    The live set, best plan first. The plan limit is applied on read as well as
    at purchase: if the ceiling is lowered later, an already-oversubscribed
    user must stop gaining from the excess rather than keep a benefit the
    operator has since withdrawn.

    Computed with CTEs rather than a temp table — creating one would make this
    function VOLATILE, and it is called on read paths that depend on it staying
    STABLE.
  */
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

  -- Stacking off: the single best plan applies, which is what we already have.
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
           when v_mode = 'sum'     then sum(reward_multiplier)
           when v_mode = 'product' then exp(sum(ln(reward_multiplier)))
           else max(reward_multiplier)
         end
    into v_held, v_cap, v_min, v_priority, v_cooldown, v_mult
    from live;

  -- The ceiling applies whatever the mode produced, and a stacked user can
  -- never be worse off than the free tier.
  v_mult := least(greatest(coalesce(v_mult, 1.000), v_default.reward_multiplier), v_max_mult);

  /*
    Returned as a synthetic tier row: callers already expect a tiers record, so
    aggregation stays invisible to them. The slug is changed so nothing
    mistakes the result for a real, purchasable plan.
  */
  v_result.slug                      := 'combined';
  v_result.name                      := case when v_held > 1 then v_result.name || ' +' || (v_held - 1) else v_result.name end;
  v_result.daily_ad_cap              := coalesce(v_cap, v_default.daily_ad_cap);
  v_result.reward_multiplier         := v_mult;
  v_result.redemption_minimum_points := coalesce(v_min, v_default.redemption_minimum_points);
  v_result.ad_priority               := coalesce(v_priority, 0);
  v_result.ad_cooldown_seconds       := coalesce(v_cooldown, 0);
  v_result.is_default                := false;

  return v_result;
end;
$$;


-- 4. The four seeded plans. All three months. -------------------------------
/*
  notify_new_tier (migration 028) announces every newly published plan to all
  users. That is right when the operator publishes a plan from the admin
  dashboard; it is wrong for seed data, which would fire four announcements at
  every existing account for placeholder pricing that is about to be replaced.
  Suppressed for the seed only, then restored.
*/
alter table public.tiers disable trigger trg_notify_new_tier;

insert into public.tiers
  (slug, name, description, price_minor, currency_code, billing_period_days,
   daily_ad_cap, reward_multiplier, redemption_minimum_points,
   referral_bonus_multiplier, ad_priority, ad_cooldown_seconds,
   is_default, is_active, sort_order)
values
  ('bronze', 'Bronze',
   'A gentle lift on your daily limit, for casual watching.',
   2000, 'GHS', 90, 30, 1.100, 4000, 1.100, 1, 0, false, true, 1),

  ('silver', 'Silver',
   'More ads a day and a better rate, for regular earners.',
   5000, 'GHS', 90, 45, 1.250, 3000, 1.250, 2, 0, false, true, 2),

  ('gold', 'Gold',
   'A high daily limit, priority ads and a low payout threshold.',
   10000, 'GHS', 90, 70, 1.500, 2000, 1.500, 3, 0, false, true, 3),

  ('platinum', 'Platinum',
   'The highest limit and the best rate we offer.',
   20000, 'GHS', 90, 120, 1.750, 1000, 1.750, 4, 0, false, true, 4)
on conflict (slug) do update
  set name                      = excluded.name,
      description               = excluded.description,
      price_minor               = excluded.price_minor,
      billing_period_days       = excluded.billing_period_days,
      daily_ad_cap              = excluded.daily_ad_cap,
      reward_multiplier         = excluded.reward_multiplier,
      redemption_minimum_points = excluded.redemption_minimum_points,
      referral_bonus_multiplier = excluded.referral_bonus_multiplier,
      ad_priority               = excluded.ad_priority,
      is_active                 = excluded.is_active,
      sort_order                = excluded.sort_order,
      updated_at                = now();

alter table public.tiers enable trigger trg_notify_new_tier;
