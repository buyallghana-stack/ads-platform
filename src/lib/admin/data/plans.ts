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
    // the value-per-cedi arithmetic never runs on strings.
    priceGhs: Number(row.price_ghs),
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
  }))
}
