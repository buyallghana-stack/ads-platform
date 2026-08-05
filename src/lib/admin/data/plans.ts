import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { PlanRow } from '../types'

/**
 * The subscription plans, for real.
 *
 * The read goes through the user's own client: `admin_list_plans` is SECURITY
 * DEFINER but re-checks `is_admin()` for a non-null caller, so it answers to
 * the same predicate that guards the admin area. The writes use the service
 * client, because editing a tier changes what every holder earns.
 *
 * A plan carries its BAND (`band_max_ghs`) and what buyers actually chose to
 * pay inside it, both worked out by the database — the band by the same
 * function the payment path validates against, so the screen cannot promise a
 * range the server would refuse.
 *
 * `status` is derived from `is_active` rather than stored. The database has a
 * boolean; the screen has always spoken in live/hidden, and translating in one
 * place keeps the editor and its warnings untouched.
 */

type PlanRowRaw = {
  id: string
  slug: string
  name: string
  description: string
  price_ghs: number | string
  band_max_ghs: number | string | null
  own_band_max_ghs: number | string | null
  own_band_max_multiplier: number | string | null
  billing_period_days: number
  daily_ad_cap: number
  reward_multiplier: number | string
  redemption_minimum_points: number | string
  referral_bonus_multiplier: number | string
  ad_priority: number
  ad_cooldown_seconds: number
  is_default: boolean
  is_active: boolean
  sort_order: number
  active: number
  active_last_month: number
  monthly_ghs: number | string
  paid_count: number
  paid_above_floor: number
  paid_avg_ghs: number | string | null
}

export async function getPlans(): Promise<PlanRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_plans')

  if (error) throw new Error(`Could not load plans: ${error.message}`)

  return ((data ?? []) as unknown as PlanRowRaw[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    // numeric arrives as a string over PostgREST. Converted once, here, so
    // nothing downstream does band arithmetic on strings.
    priceGhs: Number(row.price_ghs),
    // Null is meaningful here — the free plan and hidden plans have no band —
    // so it survives rather than becoming Number(null) === 0.
    bandMaxGhs: row.band_max_ghs === null ? null : Number(row.band_max_ghs),
    /* Null on every rung with a plan above it, which is most of them. Same
       reason: Number(null) is 0, and a 0 here would read as a ceiling of
       GHS 0 rather than "the plan above decides". */
    ownBandMaxGhs: row.own_band_max_ghs === null ? null : Number(row.own_band_max_ghs),
    ownBandMaxMultiplier:
      row.own_band_max_multiplier === null ? null : Number(row.own_band_max_multiplier),
    billingPeriodDays: row.billing_period_days,
    dailyAdCap: row.daily_ad_cap,
    rewardMultiplier: Number(row.reward_multiplier),
    redemptionMinimumPoints: Number(row.redemption_minimum_points),
    referralBonusMultiplier: Number(row.referral_bonus_multiplier),
    adPriority: row.ad_priority,
    adCooldownSeconds: row.ad_cooldown_seconds,
    isDefault: row.is_default,
    status: row.is_active ? 'live' : 'hidden',
    sortOrder: row.sort_order,
    active: row.active,
    activeLastMonth: row.active_last_month,
    monthlyGhs: Number(row.monthly_ghs),
    paidCount: row.paid_count,
    paidAboveFloor: row.paid_above_floor,
    paidAvgGhs: row.paid_avg_ghs === null ? null : Number(row.paid_avg_ghs),
  }))
}
