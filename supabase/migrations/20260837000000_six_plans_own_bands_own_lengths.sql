-- ============================================================================
-- Migration 189 — six plans, each with its own price band and its own length
--
-- Operator, 2026-08-12, after reading the ladder proposal: apply it, with two
-- new plans filling the widest gaps and plan length rising 50 to 55 days.
--
--   plan       price          ads/day   value of an ad     runs
--   Bronze     GHS 85-105        3      1.13 -> 1.40       50 days
--   Silver     GHS 145-180       4      1.45 -> 1.80       51 days
--   Pearl      GHS 230-285       5      1.84 -> 2.28       52 days   NEW
--   Gold       GHS 400-500       7      2.29 -> 2.86       53 days
--   Sapphire   GHS 720-900      10      2.88 -> 3.60       54 days   NEW
--   Platinum   GHS 1180-1500    13      3.63 -> 4.62       55 days
--
-- Every plan repays in 25 days at any price inside its range, which is the
-- whole design: `value of an ad = price / (ads per day x 25)`.
--
-- ⚠️ I ADVISED AGAINST THE LENGTHS AND THE OPERATOR DECIDED OTHERWISE, which
-- is their call and is recorded here rather than argued again. A 25-day
-- payback inside a 50 to 55 day plan pays out roughly twice: a Platinum member
-- at GHS 1,500 who watches all 13 ads every day receives GHS 2,970 after the
-- withdrawal fee, GHS 1,470 more than they paid. Break-even sits at about half
-- the allowance watched on every plan. The brake that exists in practice is
-- inventory: with exclusive buckets nobody can watch more than was stocked,
-- and a full day across all six plans is 43 ads.
--
-- ── WHY THE PRICING FUNCTIONS HAD TO CHANGE ──
--
-- A band used to END where the next plan BEGINS: `plan_multiplier_for_amount`
-- took the next rung's price and multiplier as the far end of the line and
-- interpolated between them. That works when the ladder is continuous, and
-- this ladder is deliberately not — the plans have gaps so that upgrading can
-- never lower the value of an ad (there is no price at which the daily limit
-- jumps under you).
--
-- With gaps, deriving the end from the next rung would price Bronze's GHS 105
-- ceiling as if Bronze ran to GHS 145: ×1.24 instead of the ×1.40 advertised.
-- So every rung now carries its OWN `band_max_minor` and `band_max_multiplier`
-- and the functions use them. The old behaviour is kept as the fallback for
-- any rung that has none, which is how the free tier and any future rung added
-- without a ceiling still work.
--
-- ⚠️ AN AMOUNT THAT LANDS IN A GAP IS CLAMPED DOWN, never up. Somebody who
-- somehow pays GHS 130 is a Bronze member at Bronze's ceiling rate, not a
-- Silver member. The picker cannot produce such an amount — each plan card
-- clamps to its own range — but `start_subscription_payment` takes an amount
-- and this is what stops a gap from being an accidental discount on the plan
-- above.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The rate, from a band that knows its own end
-- ---------------------------------------------------------------------------

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
           /* ⚠️ THE RUNG'S OWN CEILING FIRST (migration 189). The next rung is
              only the fallback now, because this ladder has gaps between the
              plans and the next rung's price is not where this band ends. */
           coalesce(l.band_max_minor, l.next_price)           as end_price,
           coalesce(l.band_max_multiplier, l.next_multiplier) as end_multiplier,
           -- Never past the end of the line, whichever way the end was found.
           least(
             greatest(coalesce(p_minor, 0), 0),
             coalesce(l.band_max_minor, l.next_price, l.price_minor)
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


-- ---------------------------------------------------------------------------
-- The two new plans
-- ---------------------------------------------------------------------------
--
-- ⚠️ `trg_notify_new_tier` ANNOUNCES EVERY PUBLISHED PLAN TO EVERY USER. That
-- is right when an operator publishes one from the admin and wrong for a
-- migration that inserts two, so it is disabled around the insert exactly as
-- the original plan seed did on 2026-07-25.

alter table public.tiers disable trigger trg_notify_new_tier;

insert into public.tiers
  (slug, name, description, price_minor, currency_code, billing_period_days,
   daily_ad_cap, reward_multiplier, redemption_minimum_points,
   referral_bonus_multiplier, ad_priority, ad_cooldown_seconds,
   weekly_game_plays, is_default, is_active, sort_order,
   band_max_minor, band_max_multiplier)
values
  ('pearl', 'Pearl', 'Five ads a day, at a better rate than Silver.',
   23000, 'GHS', 52, 5, 1.840, 5000, 1.375, 3, 0, 2, false, true, 3, 28500, 2.280),
  ('sapphire', 'Sapphire', 'Ten ads a day, one step below Platinum.',
   72000, 'GHS', 54, 10, 2.880, 5000, 1.750, 5, 0, 4, false, true, 5, 90000, 3.600)
on conflict (slug) do update set
  name                 = excluded.name,
  description          = excluded.description,
  price_minor          = excluded.price_minor,
  billing_period_days  = excluded.billing_period_days,
  daily_ad_cap         = excluded.daily_ad_cap,
  reward_multiplier    = excluded.reward_multiplier,
  band_max_minor       = excluded.band_max_minor,
  band_max_multiplier  = excluded.band_max_multiplier,
  sort_order           = excluded.sort_order,
  is_active            = true;

alter table public.tiers enable trigger trg_notify_new_tier;


-- ---------------------------------------------------------------------------
-- The whole ladder, priced
-- ---------------------------------------------------------------------------
--
-- Sort order is renumbered to make room: free 0, bronze 1, silver 2, pearl 3,
-- gold 4, sapphire 5, platinum 6. It decides the order of `lead()` in the
-- pricing line above and the ranking in `user_target_tiers`, so it has to
-- follow the money.

update public.tiers t set
  price_minor         = v.price_minor,
  band_max_minor      = v.band_max_minor,
  reward_multiplier   = v.reward_multiplier,
  band_max_multiplier = v.band_max_multiplier,
  daily_ad_cap        = v.daily_ad_cap,
  billing_period_days = v.billing_period_days,
  sort_order          = v.sort_order,
  updated_at          = now()
from (values
  ('bronze',     8500::bigint,  10500::bigint, 1.133::numeric, 1.400::numeric,  3, 50, 1),
  ('silver',    14500,          18000,         1.450,          1.800,           4, 51, 2),
  ('pearl',     23000,          28500,         1.840,          2.280,           5, 52, 3),
  ('gold',      40000,          50000,         2.286,          2.857,           7, 53, 4),
  ('sapphire',  72000,          90000,         2.880,          3.600,          10, 54, 5),
  ('platinum', 118000,         150000,         3.631,          4.615,          13, 55, 6)
) as v(slug, price_minor, band_max_minor, reward_multiplier, band_max_multiplier,
       daily_ad_cap, billing_period_days, sort_order)
where t.slug = v.slug;

/* The free plan keeps its one ad at ×1 and gains nothing here, but its length
   is brought in line so every plan in the table means the same thing by
   "runs for". A free plan does not expire in practice — `resolve_user_tier`
   falls back to it — so this is cosmetic. */
update public.tiers set billing_period_days = 50 where is_default;


-- ---------------------------------------------------------------------------
-- The ceiling that would otherwise trim the top of the ladder
-- ---------------------------------------------------------------------------
--
-- `subscription_max_combined_multiplier` was raised to 10.000 on 2026-08-05
-- after it was found clamping Platinum holders at 3.500. Platinum now reaches
-- ×4.615, so 10 is still clear of it. Asserted rather than assumed: a ceiling
-- below the ladder underpays every member on the top plan and nothing else
-- reports it.
do $$
declare
  v_ceiling numeric := coalesce(
    (select value::numeric from public.app_config
      where key = 'subscription_max_combined_multiplier'), 0);
  v_top numeric := (select max(coalesce(band_max_multiplier, reward_multiplier))
                      from public.tiers where is_active);
begin
  if v_ceiling < v_top then
    raise exception
      'subscription_max_combined_multiplier is %, below the top of the ladder (%)',
      v_ceiling, v_top;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- The ceiling the CHECKOUT enforces, and the screens quote
-- ---------------------------------------------------------------------------
--
-- Operator, 2026-08-12: the gap "didnt display at the upgrade screen".
-- Correct, and it was worse than a display fault. `plan_band_max_minor` is
-- what `start_subscription_payment` validates an amount against and what the
-- plan cards quote as a band's top, and it still derived that top from the
-- NEXT plan's price. So Bronze read as GHS 85 to 144.99 on the screen, and the
-- till would have taken GHS 144 for it — an amount inside the gap, priced at
-- Bronze's ceiling rate, which is a worse deal than the plan advertises and a
-- support ticket waiting to happen.
--
-- Same precedence as the rate: the rung's own ceiling first, the next rung
-- only as the fallback for a ladder without gaps.

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
           /* ⚠️ ITS OWN CEILING WINS (migration 189). A band with gaps around
              it does not run to the next plan's price. */
           when r.band_max_minor is not null then r.band_max_minor
           when r.next_price is not null     then r.next_price - 1
           else r.price_minor
         end
    from rungs r
   where r.id = p_tier_id;
$$;
