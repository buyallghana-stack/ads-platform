import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Read side of subscriptions. Both reads go through the RLS user client:
 * active tiers are readable by anyone, subscriptions only by their owner —
 * the policies already say exactly what this screen needs.
 */
export type Plan = {
  id: string
  slug: string
  name: string
  description: string | null
  priceMinor: number
  currencyCode: string
  periodDays: number
  dailyAdCap: number
  rewardMultiplier: number
  redemptionMinimumPoints: number
  referralBonusMultiplier: number
  adPriority: number
  sortOrder: number
}

export type HeldPlan = {
  tierId: string
  status: string
  endsAt: string
  startedAt: string
}

/** Paid, purchasable plans, cheapest first. The default tier is not one. */
export const getPlans = cache(async (): Promise<Plan[]> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tiers')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', false)
    .order('sort_order', { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceMinor: Number(row.price_minor),
    currencyCode: row.currency_code,
    periodDays: row.billing_period_days,
    dailyAdCap: row.daily_ad_cap,
    rewardMultiplier: Number(row.reward_multiplier),
    redemptionMinimumPoints: Number(row.redemption_minimum_points),
    referralBonusMultiplier: Number(row.referral_bonus_multiplier),
    adPriority: row.ad_priority,
    sortOrder: row.sort_order,
  }))
})

/** The plans this user currently holds — active, or inside their grace period. */
export const getHeldPlans = cache(async (userId: string): Promise<HeldPlan[]> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_subscriptions')
    .select('tier_id, status, current_period_end, started_at, grace_ends_at')
    .eq('user_id', userId)
    .in('status', ['active', 'grace'])

  const now = Date.now()
  return (data ?? [])
    .filter((row) => {
      const end =
        row.status === 'grace' && row.grace_ends_at
          ? new Date(row.grace_ends_at).getTime()
          : new Date(row.current_period_end).getTime()
      return end > now
    })
    .map((row) => ({
      tierId: row.tier_id,
      status: row.status,
      startedAt: row.started_at,
      endsAt:
        row.status === 'grace' && row.grace_ends_at
          ? row.grace_ends_at
          : row.current_period_end,
    }))
})

/**
 * What the user's benefits currently add up to. `resolve_user_tier` already
 * does the combining (migration 035), so this screen never re-implements the
 * stacking rules — a second copy of that maths is a second place for it to be
 * wrong.
 */
export type ResolvedBenefits = {
  name: string
  dailyAdCap: number
  rewardMultiplier: number
  redemptionMinimumPoints: number
  isDefault: boolean
}

export const getResolvedBenefits = cache(
  async (userId: string): Promise<ResolvedBenefits | null> => {
    const supabase = await createClient()
    const { data } = await supabase.rpc('resolve_user_tier', { p_user_id: userId })
    if (!data) return null

    const row = data as unknown as {
      name: string
      daily_ad_cap: number
      reward_multiplier: string | number
      redemption_minimum_points: string | number
      is_default: boolean
    }
    return {
      name: row.name,
      dailyAdCap: row.daily_ad_cap,
      rewardMultiplier: Number(row.reward_multiplier),
      redemptionMinimumPoints: Number(row.redemption_minimum_points),
      isDefault: row.is_default,
    }
  },
)

/**
 * Reference values the Upgrade screen needs to explain a plan in plain terms:
 * the free allowance a plan is measured against, and what a point is worth.
 * Both are operator config, so neither is hardcoded in the UI.
 */
export const getPlanReferences = cache(
  async (): Promise<{ freeDailyAdCap: number; pointsPerCurrencyUnit: number }> => {
    const supabase = await createClient()

    const [{ data: free }, { data: rate }] = await Promise.all([
      supabase.from('tiers').select('daily_ad_cap').eq('is_default', true).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', 'points_per_currency_unit').maybeSingle(),
    ])

    return {
      freeDailyAdCap: free?.daily_ad_cap ?? 20,
      pointsPerCurrencyUnit: Number(rate?.value ?? 1000),
    }
  },
)
