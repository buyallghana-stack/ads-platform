-- ============================================================================
-- Migration 177 — plans that stack add their daily ad caps again
--
-- Operator, 2026-08-11: manager holds all four plans and can still only watch
-- 13 ads a day, "which is contrary to what was promised".
--
-- They are right, and the promise is still on the live site. Three pieces of
-- copy say it: the landing page ("Hold more than one and the daily limits add
-- up"), the nav teaser ("Every one you hold adds to your daily limit") and the
-- profile ("Adding another raises your daily limit").
--
-- ── WHERE IT WENT ──
--
-- Migration 036 built exactly that: free cap counted ONCE, plus each plan's cap
-- above the free one. Migration 098 (flexible plan pricing, 2026-08-04) then
-- rewrote `resolve_user_tier` around a single number, the total live spend, and
-- said so in its own comment: "The old function combined held plans with a
-- sum_bonus rule. That machinery is gone, because adding money IS the stacking
-- rule now."
--
-- That reasoning holds for the RATE, which is interpolated along the ladder and
-- really does make two payments of GHS 100 land where one of GHS 200 lands. It
-- does not hold for a whole number that comes off a band row, and this is the
-- result: manager paid GHS 1,717 across four plans and is handed Platinum's 13,
-- the same as somebody who paid GHS 520 once. Money bought nothing.
--
-- ── THE RULE NOW ──
--
--   daily ad cap = the BETTER of
--                    what the band gives (today's answer), and
--                    the free cap once + the sum of each held plan's cap
--                    above the free cap (migration 036's answer)
--
-- Taking the better of the two is not a fudge, it is the only combination that
-- keeps both promises without taking anything from anybody. The band alone
-- breaks "the limits add up". The sum alone would CUT somebody who holds one
-- cheap plan but paid deep into a higher band: Bronze bought at GHS 600 lands
-- in the Platinum band and gets 13 today, while the sum of what they hold is 3.
-- This change cannot lower any existing user's cap, which is the property worth
-- having on a live money path.
--
-- Manager, on the live ladder: 1 + (3-1) + (4-1) + (7-1) + (13-1) = 24.
--
-- ⚠️ THE CONSEQUENCE, stated plainly: the ladder's caps are not uniform per
-- cedi (Bronze sells 0.031 ads per cedi, Silver 0.021), so four plans bought at
-- their floors, GHS 975, now buy 24 ads a day while GHS 1,000 on Platinum alone
-- buys 13. Spending less can buy more, which is the same inversion migration
-- 036 removed for the multiplier. The fix is not in this function, it is in the
-- ladder: caps have to stay roughly proportional to price, exactly as the
-- multipliers do. The admin plan editor is where that belongs, and the operator
-- retunes it there.
--
-- `ad_cap_combine_mode` makes the whole thing a setting, per the standing
-- condition that decisions like this are reachable in the admin.
--
-- ── AND A SWITCH THAT DID NOTHING ──
--
-- `subscription_stacking_enabled` has been read by NOBODY since migration 098
-- dropped the branch that used it. It is rendered in Platform settings, it is
-- described as "False = the highest single plan applies", and turning it off
-- changed nothing at all. It is honoured again below. See
-- [[code-behind-a-money-switch-is-unclicked]]: a money switch nobody has
-- clicked is not evidence that it works.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The setting
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, description)
values (
  'ad_cap_combine_mode',
  'sum_bonus',
  'text',
  'How daily ad caps combine for a user holding several plans. "sum_bonus" (the promise on the landing page) counts the free allowance once and adds each plan''s cap above it, never going below what their total spend already buys. "band" takes only what the total buys, which is what shipped between 2026-08-04 and 2026-08-11. "highest" takes the best single plan.'
)
on conflict (key) do nothing;

/* The screen offers three options and the function implements three branches.
   `config_allowed_values` is what stops those two lists drifting: a save of
   anything else fails loudly rather than falling through to a default nobody
   chose. */
create or replace function public.config_allowed_values(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'subscription_multiplier_combine_mode'
      then array['sum_bonus', 'sum', 'product', 'highest']
    when 'referral_purchase_commission_scope'
      then array['first', 'new_plans', 'all']
    when 'game_plays_combine_mode'
      then array['highest', 'sum_bonus']
    when 'ad_cap_combine_mode'
      then array['sum_bonus', 'band', 'highest']
    else null
  end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Resolving somebody's benefits
-- ---------------------------------------------------------------------------

create or replace function public.resolve_user_tier(p_user_id uuid)
returns public.tiers
language plpgsql
stable
set search_path = ''
as $$
declare
  v_total    bigint;
  v_band     public.tiers;
  v_default  public.tiers;
  v_free_cap int;
  v_cap      int;
  v_priority int;
  v_cooldown int;
  v_mode     text    := coalesce(public.config_text('ad_cap_combine_mode'), 'sum_bonus');
  v_stacking boolean := coalesce(public.config_bool('subscription_stacking_enabled'), true);
  v_ceiling  numeric := coalesce(
    (select value::numeric from public.app_config where key = 'subscription_max_combined_multiplier'),
    3.500);
  /* Platform-wide since 2026-08-01: no plan has its own withdrawal threshold.
     It is set on EVERY path out of this function — the free one included —
     because every screen reads its answer, and a screen disagreeing with
     `request_redemption` is the failure that rule was written to remove. */
  v_minimum  bigint := public.config_int('redemption_minimum_points');
begin
  select t.* into v_default from public.tiers t where t.is_default limit 1;
  v_default.redemption_minimum_points := v_minimum;
  v_free_cap := greatest(coalesce(v_default.daily_ad_cap, 0), 0);

  if v_stacking then
    select coalesce(sum(coalesce(s.amount_minor, t.price_minor)), 0)
      into v_total
      from public.user_subscriptions s
      join public.tiers t on t.id = s.tier_id
     where s.user_id = p_user_id
       and (
         (s.status = 'active' and now() < s.current_period_end)
         or
         (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
       );
  else
    /* Stacking switched off: the single best plan they hold, at the amount
       they actually paid for THAT one. Not the sum, and not the plan's list
       price either, or turning the switch off would quietly reprice everybody
       who paid above a floor. */
    select coalesce(s.amount_minor, t.price_minor)
      into v_total
      from public.user_subscriptions s
      join public.tiers t on t.id = s.tier_id
     where s.user_id = p_user_id
       and (
         (s.status = 'active' and now() < s.current_period_end)
         or
         (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
       )
     order by t.sort_order desc, coalesce(s.amount_minor, t.price_minor) desc
     limit 1;
  end if;

  if coalesce(v_total, 0) <= 0 then
    return v_default;
  end if;

  v_band := public.plan_band_for_amount(v_total);
  if v_band.id is null then
    return v_default;
  end if;

  /* The rate follows the money. */
  v_band.reward_multiplier         := least(public.plan_multiplier_for_amount(v_total), v_ceiling);
  v_band.redemption_minimum_points := v_minimum;
  v_band.is_default                := false;

  /* The whole numbers follow the PLANS HELD, and never drop below what the
     band alone would have given. `not t.is_default` keeps the free row out of
     the sum: it is added once, above, and a user cannot hold it as a purchase
     anyway. */
  if v_stacking and v_mode <> 'band' then
    select
      case
        when v_mode = 'highest' then max(t.daily_ad_cap)
        else v_free_cap + coalesce(sum(greatest(t.daily_ad_cap - v_free_cap, 0)), 0)
      end,
      max(t.ad_priority),
      min(nullif(t.ad_cooldown_seconds, 0))
      into v_cap, v_priority, v_cooldown
      from public.user_subscriptions s
      join public.tiers t on t.id = s.tier_id
     where s.user_id = p_user_id
       and not t.is_default
       and (
         (s.status = 'active' and now() < s.current_period_end)
         or
         (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
       );

    v_band.daily_ad_cap := greatest(coalesce(v_cap, 0), v_band.daily_ad_cap);
    v_band.ad_priority  := greatest(coalesce(v_priority, 0), coalesce(v_band.ad_priority, 0));

    /* Lower is better, and zero means "no cooldown configured" rather than
       "instant", which is why the null trick is on the way in above. */
    if v_cooldown is not null then
      v_band.ad_cooldown_seconds := least(
        v_cooldown,
        coalesce(nullif(v_band.ad_cooldown_seconds, 0), v_cooldown)
      );
    end if;
  end if;

  return v_band;
end;
$$;

/* NO GRANT CHANGES HERE, DELIBERATELY. `create or replace` on an existing
   signature keeps the ACL; it is DROP followed by CREATE that re-grants to
   PUBLIC, which is the trap behind migrations 103 and 104. This function is
   currently executable by anon and that is correct: it is SECURITY INVOKER, so
   an anonymous caller reads `user_subscriptions` through RLS, sees no rows and
   is handed the free tier. Revoking here would break the logged-out marketing
   page rather than close a hole. */


-- ---------------------------------------------------------------------------
-- 3. A description that had quietly become false
-- ---------------------------------------------------------------------------
-- `game_plays_combine_mode` tells the operator that sum_bonus "matches how ad
-- caps and multipliers stack". That stopped being true on 2026-08-04 and is
-- true again as of this migration, so the wording stays; only the reference to
-- the ad cap setting is added, because there are now two of these and choosing
-- one without seeing the other is how they end up contradicting each other.

update public.app_config
   set description = 'How weekly plays combine for a user holding several plans. "highest" (operator choice, 2026-07-30) takes the best single plan. "sum_bonus" adds each plan''s bonus over the free allowance, matching ad_cap_combine_mode and the reward multiplier.'
 where key = 'game_plays_combine_mode';
