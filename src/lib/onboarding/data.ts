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

export type UpgradePitch = {
  slug: string
  name: string
  /** The band's floor, in cedis. The cheapest way in. */
  priceGhs: number
  dailyAdCap: number
  pointsPerAd: number
  /** What a full day of watching pays, in cedis. */
  dailyGhs: number
  termDays: number
  /** Everything the term pays if they watch every ad, every day. */
  termGhs: number
  /** The free plan, for the comparison the pitch is built on. */
  freeDailyGhs: number
  freeDays: number
}

/**
 * The numbers behind the upgrade sheet, read live.
 *
 * ⚠️ NOT HARDCODED, AND NOT COPIED INTO THE TRANSLATION FILES. The operator
 * retunes the ladder from the admin, and a pitch quoting last month's rate
 * would be a promise the product then fails to keep on the very first day of a
 * member's plan. The one place this may come from is `tiers`.
 *
 * It offers the CHEAPEST rung on sale, at its floor. The sheet appears seconds
 * after somebody earned one cedi, so the number beside it has to be the
 * smallest true one; leading with Gold at GHS 400 reads as a different product
 * than the one they just used.
 */
export async function getUpgradePitch(): Promise<UpgradePitch | null> {
  const supabase = await createClient()

  const [{ data: tiers }, { data: config }] = await Promise.all([
    supabase
      .from('tiers')
      .select('slug, name, price_minor, reward_multiplier, daily_ad_cap, billing_period_days, is_default, is_active, coming_soon')
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('app_config').select('key, value').in('key', ['points_per_currency_unit', 'free_earning_days']),
  ])

  if (!tiers?.length) return null

  const value = (key: string, fallback: number) =>
    Number(config?.find((c) => c.key === key)?.value ?? fallback) || fallback

  const perCedi = value('points_per_currency_unit', 100)
  const freeDays = value('free_earning_days', 21)

  const free = tiers.find((t) => t.is_default)
  /* Announced is not on sale. Pitching a `coming_soon` rung would send them to
     a card they cannot buy, which turns the best moment in the funnel into a
     dead end. */
  const cheapest = tiers.find((t) => !t.is_default && !t.coming_soon)
  if (!cheapest) return null

  const { pointsPerAd } = await import('@/lib/subscriptions/pricing')
  const perAd = pointsPerAd(BASE_AD_POINTS, Number(cheapest.reward_multiplier))
  const dailyGhs = (cheapest.daily_ad_cap * perAd) / perCedi

  return {
    slug: cheapest.slug,
    name: cheapest.name,
    priceGhs: Number(cheapest.price_minor) / 100,
    dailyAdCap: cheapest.daily_ad_cap,
    pointsPerAd: perAd,
    dailyGhs,
    termDays: cheapest.billing_period_days,
    termGhs: dailyGhs * cheapest.billing_period_days,
    freeDailyGhs: free ? (free.daily_ad_cap * pointsPerAd(BASE_AD_POINTS, Number(free.reward_multiplier))) / perCedi : 0,
    freeDays,
  }
}

/*
  `base_ad_points` is a PRIVATE config key, so the user client reads it back as
  null and the pitch would quietly quote zero. It is 100 and has been since the
  peg was set; the ladder script makes the same assumption and for the same
  reason. If it ever moves, both move together.
*/
const BASE_AD_POINTS = 100
