import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { ONBOARDING_OFF, type OnboardingState } from '@/lib/onboarding/types'

/**
 * Where a member is up to in the walkthrough.
 *
 * ⚠️ TAKES THE SUBJECT AS AN ARGUMENT, AND THE CALLER PASSES THE VIEWER. Under
 * "view as user" the admin keeps their own Supabase session, so a read that
 * resolved `auth.uid()` itself would render the ADMIN's progress on the
 * member's screen. Pass `getViewerUser()`, as every other screen in the group
 * does. The database enforces the other half: you may ask about yourself, and
 * staff may ask about anybody.
 *
 * Failing to OFF is deliberate. A walkthrough that half renders because a read
 * failed is a blocking overlay with no way out of it, so the failure mode has
 * to be "no walkthrough", never "stuck walkthrough".
 */
export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_onboarding_state', { p_user_id: userId })

  if (error || !data) return ONBOARDING_OFF

  const raw = data as Partial<OnboardingState>
  if (!raw.enabled) return ONBOARDING_OFF

  return {
    enabled: true,
    started: Boolean(raw.started),
    skipped: Boolean(raw.skipped),
    completed: Boolean(raw.completed),
    currentStep: raw.currentStep ?? null,
    steps: raw.steps ?? [],
    total: Number(raw.total ?? 0),
    doneCount: Number(raw.doneCount ?? 0),
    firstAdDone: Boolean(raw.firstAdDone),
    firstAdBlocked: Boolean(raw.firstAdBlocked),
    adPoints: Number(raw.adPoints ?? 0),
    pointsPerCedi: Number(raw.pointsPerCedi ?? 100) || 100,
  }
}

export type UpgradePlan = {
  slug: string
  name: string
  /** What the plan is for, in the operator's own words from the plans table. */
  description: string
  /** The band: the least you may pay, and the most. */
  priceFromGhs: number
  priceToGhs: number
  dailyAdCap: number
  /** Points one ad pays, at the band's floor and at its ceiling. */
  pointsFrom: number
  pointsTo: number
  /** A full day of watching, in cedis, across the band. */
  dailyFromGhs: number
  dailyToGhs: number
  termDays: number
  weeklyGamePlays: number
  /** The referral bonus, as a percentage over the base. 1.10 reads as +10%. */
  referralBonusPercent: number
}

export type UpgradeOffer = {
  plans: UpgradePlan[]
  /** The free plan, for the one comparison line the offer opens with. */
  freeDailyGhs: number
  freeDays: number
}

/*
  `base_ad_points` is a PRIVATE config key: the user client reads it back as
  null and every figure here would quietly become zero. It is 100 and has been
  since the peg was set, and `scripts/apply-plan-ladder.mjs` makes the same
  assumption for the same reason. If it ever moves, both move together.
*/
const BASE_AD_POINTS = 100

/**
 * The plans the offer shows, read live.
 *
 * ⚠️ NOT HARDCODED, AND NOT IN THE TRANSLATION FILES. The operator retunes
 * this ladder from the admin, and an offer quoting last month's rate is a
 * promise the product breaks on day one of the plan it just sold.
 *
 * ⚠️ THE FREE PLAN IS NOT A CARD (operator, 2026-09-23). Everybody seeing this
 * screen is already on it, so a card for it is a card offering them what they
 * have. It survives only as the one comparison line above the carousel.
 *
 * Announced plans are left out too: `coming_soon` cannot be bought, and a card
 * that leads to a checkout refusing the sale is worse than no card.
 */
export async function getUpgradeOffer(): Promise<UpgradeOffer | null> {
  const supabase = await createClient()

  const [{ data: tiers }, { data: config }] = await Promise.all([
    supabase
      .from('tiers')
      .select(
        'slug, name, description, price_minor, band_max_minor, reward_multiplier, band_max_multiplier, daily_ad_cap, billing_period_days, weekly_game_plays, referral_bonus_multiplier, is_default, is_active, coming_soon',
      )
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['points_per_currency_unit', 'free_earning_days']),
  ])

  if (!tiers?.length) return null

  const setting = (key: string, fallback: number) =>
    Number(config?.find((c) => c.key === key)?.value ?? fallback) || fallback

  const perCedi = setting('points_per_currency_unit', 100)
  const freeDays = setting('free_earning_days', 21)

  const { pointsPerAd } = await import('@/lib/subscriptions/pricing')
  const free = tiers.find((t) => t.is_default)

  const plans = tiers
    .filter((t) => !t.is_default && !t.coming_soon)
    .map((t) => {
      const floorRate = Number(t.reward_multiplier)
      const ceilRate = Number(t.band_max_multiplier ?? t.reward_multiplier)
      const pointsFrom = pointsPerAd(BASE_AD_POINTS, floorRate)
      const pointsTo = pointsPerAd(BASE_AD_POINTS, ceilRate)

      return {
        slug: t.slug,
        name: t.name,
        description: t.description ?? '',
        priceFromGhs: Number(t.price_minor) / 100,
        priceToGhs: Number(t.band_max_minor ?? t.price_minor) / 100,
        dailyAdCap: t.daily_ad_cap,
        pointsFrom,
        pointsTo,
        dailyFromGhs: (t.daily_ad_cap * pointsFrom) / perCedi,
        dailyToGhs: (t.daily_ad_cap * pointsTo) / perCedi,
        termDays: t.billing_period_days,
        weeklyGamePlays: t.weekly_game_plays,
        referralBonusPercent: Math.round((Number(t.referral_bonus_multiplier) - 1) * 100),
      }
    })

  if (plans.length === 0) return null

  return {
    plans,
    freeDailyGhs: free
      ? (free.daily_ad_cap * pointsPerAd(BASE_AD_POINTS, Number(free.reward_multiplier))) / perCedi
      : 0,
    freeDays,
  }
}
