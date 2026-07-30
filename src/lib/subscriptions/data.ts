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
 * Where the user stands against the plans on sale — the only thing the
 * "upgrade" promos need to know.
 *
 *   none  owns nothing        -> offer the upgrade
 *   some  owns 1..n-1         -> offer to ADD, because plans stack; calling it
 *                               an "upgrade" is wrong once they already hold
 *                               one, and implies replacing what they bought
 *   all   owns every plan     -> say nothing at all. There is nothing left to
 *                               sell, and a permanent nag to a customer who
 *                               has bought everything is the worst version of
 *                               this component.
 *
 * Both reads are React-cached, so the layout and the profile page asking the
 * same question in one request costs one pair of queries.
 */
export type PlanStanding = 'none' | 'some' | 'all'

export const getPlanStanding = cache(async (userId: string): Promise<PlanStanding> => {
  const [plans, held] = await Promise.all([getPlans(), getHeldPlans(userId)])
  // No purchasable plans configured is not an upsell opportunity either.
  if (plans.length === 0) return 'all'

  const heldIds = new Set(held.map((h) => h.tierId))
  const owned = plans.filter((p) => heldIds.has(p.id)).length

  if (owned === 0) return 'none'
  return owned >= plans.length ? 'all' : 'some'
})

/**
 * Reference values the Upgrade screen needs to explain a plan in plain terms:
 * the free allowance a plan is measured against, and what a point is worth.
 * Both are operator config, so neither is hardcoded in the UI.
 */
export const getPlanReferences = cache(
  async (): Promise<{ freeDailyAdCap: number; freeName: string; pointsPerCurrencyUnit: number }> => {
    const supabase = await createClient()

    const [{ data: free }, { data: rate }] = await Promise.all([
      supabase.from('tiers').select('daily_ad_cap, name').eq('is_default', true).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', 'points_per_currency_unit').maybeSingle(),
    ])

    return {
      freeDailyAdCap: free?.daily_ad_cap ?? 20,
      // The plan's own name, not a hardcoded "Free" — an operator who renames
      // the default tier should see that name on the cards.
      freeName: free?.name ?? 'Free',
      pointsPerCurrencyUnit: Number(rate?.value ?? 1000),
    }
  },
)
