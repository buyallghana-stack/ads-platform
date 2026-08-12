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
  /**
   * The band this plan covers, in minor units — what somebody may choose to
   * pay for it. `bandMaxMinor` equals the price on the top plan, which has
   * nothing above it to interpolate towards.
   */
  bandMinMinor: number
  bandMaxMinor: number
  /** The multiplier of the NEXT plan up — the value this band interpolates
   *  towards. Equal to this plan's own on the top plan, where the line ends. */
  nextMultiplier: number
  /**
   * The amount at which `nextMultiplier` is reached exactly.
   *
   * NOT the same as `bandMaxMinor`, and the difference is one pesewa that
   * matters. Between two rungs the band stops one pesewa BELOW the next plan's
   * price, so the line ends past the top of the band and the two bands meet
   * without a step. The top rung has no plan above it to hand off to, so when
   * it carries its own ceiling the line ends ON it, and paying the ceiling
   * pays exactly that rate.
   *
   * Equal to `bandMinMinor` on a top plan with no ceiling — a band of one
   * price, where there is no line to walk.
   */
  lineEndMinor: number
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

  const rows = data ?? []

  return rows.map((row, i) => {
    /* ⚠️ A PLAN'S OWN CEILING WINS (migration 189). Since the ladder gained
       gaps between the plans, a band no longer ends where the next one begins:
       Bronze sells GHS 85 to 105 and Silver starts at 145, so deriving the end
       from the next rung would price Bronze's ceiling as if the band ran to
       GHS 145 and quote a rate the database will not pay.

       Where a rung carries no ceiling of its own the old rule still applies —
       the band runs to one pesewa under the next plan — which is what keeps a
       continuous ladder (and every fixture that pins one) working unchanged.

       This mirrors `plan_multiplier_for_amount` line for line. The last test in
       flexible-pricing.test.ts sweeps the whole live ladder comparing the two,
       and it is the reason this comment exists rather than a bug report. */
    const own = row.band_max_minor === null ? null : Number(row.band_max_minor)
    const ownRate = row.band_max_multiplier === null ? null : Number(row.band_max_multiplier)
    const next = i + 1 < rows.length ? rows[i + 1] : null

    const lineEnd = own ?? (next ? Number(next.price_minor) : Number(row.price_minor))
    const endRate =
      ownRate ?? (next ? Number(next.reward_multiplier) : Number(row.reward_multiplier))

    return {
      bandMinMinor: Number(row.price_minor),
      /* One pesewa under the next plan only when the end IS the next plan;
         a band with its own ceiling sells right up to it. */
      bandMaxMinor: own ?? (next ? Number(next.price_minor) - 1 : Number(row.price_minor)),
      nextMultiplier: endRate,
      lineEndMinor: lineEnd,
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
    }
  })
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
  async (): Promise<{
    freeDailyAdCap: number
    freeName: string
    pointsPerCurrencyUnit: number
    baseAdPoints: number
  }> => {
    const supabase = await createClient()

    const [{ data: free }, { data: rate }, { data: ads }] = await Promise.all([
      supabase.from('tiers').select('daily_ad_cap, name').eq('is_default', true).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', 'points_per_currency_unit').maybeSingle(),
      /* What a typical ad is worth before any multiplier. Read from the POOL
         rather than assumed, so the preview on the upgrade screen matches the
         ads that are actually out there — if the operator prices ads at 200,
         the slider says what 200 becomes. */
      supabase.from('ads').select('points_reward').eq('status', 'active').limit(200),
    ])

    const rewards = (ads ?? []).map((a) => Number(a.points_reward)).filter((n) => n > 0).sort((a, b) => a - b)
    // The median, not the mean: one 5,000-point launch ad should not drag the
    // number everybody sees.
    const baseAdPoints = rewards.length ? rewards[Math.floor(rewards.length / 2)]! : 100

    return {
      baseAdPoints,
      freeDailyAdCap: free?.daily_ad_cap ?? 20,
      // The plan's own name, not a hardcoded "Free" — an operator who renames
      // the default tier should see that name on the cards.
      freeName: free?.name ?? 'Free',
      pointsPerCurrencyUnit: Number(rate?.value ?? 1000),
    }
  },
)
