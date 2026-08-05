import type { PlanRow } from './types'

/**
 * The rules that keep a LADDER OF BANDS honest.
 *
 * WHAT CHANGED, AND WHY THIS FILE WAS REWRITTEN
 * Until migration 098 a plan had a price, and this file enforced one rule:
 * every plan on the same value per cedi, so that no combination of cheap plans
 * could beat a dear one (migration 037).
 *
 * A plan is now a BAND. It runs from its own price to one pesewa under the
 * next plan's, and `plan_multiplier_for_amount` interpolates the earning rate
 * in a straight line between the two rungs. That changes what can go wrong:
 *
 *   - Inside a band, value per cedi is straight BY CONSTRUCTION. There is
 *     nothing left to check there.
 *   - Between rungs, the operator deliberately chose a curve — GHS 1 buys
 *     +0.77% of earning at Bronze and +0.25% at Diamond. Measuring that
 *     against a single "house rate" flagged four of the five plans as broken
 *     the day bands shipped. It was not a warning; it was noise about a
 *     decision that had already been made.
 *
 * So the checks here are the ones that are still real, and every one of them
 * is a thing that MAKES A PLAN MISBEHAVE rather than a matter of taste:
 *
 *   unbuyable         the band is empty, so `start_subscription_payment`
 *                     rejects every amount — the plan cannot be sold at all.
 *   earningInversion  the plan above earns LESS, so inside this band paying
 *                     more lowers the rate. The slider would run backwards.
 *   adsInversion      the plan above shows fewer ads a day.
 *   undercut          two cheaper plans held together still beat this one.
 *                     Plans stack, so this survived the restructure intact.
 *
 * THE BAND IS CUT BY SORT ORDER, NOT BY PRICE. `plan_band_max_minor` uses
 * `lead(price_minor) over (order by sort_order)`, so a plan that sorts after a
 * cheaper one ends its band BELOW its own floor and quietly becomes unsellable.
 * That is the whole reason `unbuyable` exists, and why everything here walks
 * the ladder in sort order. `tests/admin/plan-bands.test.ts` checks this
 * agrees with the database on the real ladder.
 *
 * Pure functions only. Nothing here blocks a save — a promotional plan is a
 * legitimate thing to want, and warnings that cannot be overruled get worked
 * around — except that the operator is told, in their own terms, what the
 * database will do with it.
 */

/** Anything the rules need. Lets a draft that has never been saved be checked
 *  beside the plans it will sit between. */
export type Rung = Pick<
  PlanRow,
  'id' | 'name' | 'priceGhs' | 'dailyAdCap' | 'rewardMultiplier' | 'sortOrder' | 'status'
> & {
  isDefault?: boolean
  /** Set only on the top rung, where there is no plan above to end the band.
   *  The plan's OWN stored ceiling — deliberately not the derived `bandMaxGhs`,
   *  which a draft does not carry precisely because it is worked out from the
   *  plan above. See `bandFor`. */
  ownBandMaxGhs?: number | null
  ownBandMaxMultiplier?: number | null
}

/**
 * The plans a band can end against: on sale, and not the free plan. In sort
 * order, because that is the order the database cuts bands in.
 */
export function ladder<T extends Rung>(plans: T[]): T[] {
  return plans
    .filter((p) => p.status === 'live' && !p.isDefault && p.priceGhs > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Ads a day everybody gets without paying — the free plan's cap. */
export function freeAdCap(plans: Rung[]): number {
  const free = plans.find((p) => p.isDefault) ?? plans.find((p) => p.priceGhs === 0)
  return free?.dailyAdCap ?? 1
}

/** The plan directly above this one, or null at the top. */
export function nextRung<T extends Rung>(plan: Rung, plans: T[]): T | null {
  const rungs = ladder(plans).filter((p) => p.id !== plan.id)
  return rungs.find((p) => p.sortOrder > plan.sortOrder) ?? null
}

export type Band = {
  fromGhs: number
  toGhs: number
  /** No plan above this one. It is still a range if it carries a ceiling of
   *  its own; without one it is a single exact price. */
  isTop: boolean
  /** True when the range is impossible — the top is below the floor. */
  empty: boolean
}

/**
 * What this plan may be paid, mirroring `plan_band_max_minor`.
 *
 * Null for the free plan and any hidden plan: neither is sold, so neither has
 * a band. A saved row should be shown the band the DATABASE returned; this is
 * for a draft the database has not seen yet.
 */
export function bandFor(plan: Rung, plans: Rung[]): Band | null {
  if (plan.isDefault || plan.status !== 'live' || plan.priceGhs <= 0) return null

  const next = nextRung(plan, plans)
  if (!next) {
    /* THE PLAN ABOVE STILL WINS WHEREVER THERE IS ONE, which is why this is
       only read at the top: a ceiling set on a middle rung would overlap the
       plan above it, and `plan_band_max_minor` ignores it for exactly that
       reason. Since migration 102 the top rung may carry its own. */
    const toGhs = plan.ownBandMaxGhs ?? plan.priceGhs
    return { fromGhs: plan.priceGhs, toGhs, isTop: true, empty: toGhs < plan.priceGhs }
  }

  // One pesewa under the next plan's price, exactly as the SQL does it.
  const toGhs = Math.round((next.priceGhs - 0.01) * 100) / 100
  return { fromGhs: plan.priceGhs, toGhs, isTop: false, empty: toGhs < plan.priceGhs }
}

/**
 * What a price should buy to sit on the straight line between its neighbours.
 *
 * This is the auto-fill for a new plan, and under bands it is the RIGHT
 * default rather than merely a tidy one: a rung placed on the line between the
 * two it sits between leaves the interpolated rate continuous across both
 * bands, so nobody crossing the boundary sees their earning rate jump.
 *
 * Below the cheapest plan the line runs up from Free (price 0, no bonus).
 * Above the dearest it continues the slope of the last segment, because there
 * is nothing to aim at.
 */
export function benefitsBetween(
  priceGhs: number,
  plans: Rung[],
): { dailyAdCap: number; rewardMultiplier: number } {
  const free = { priceGhs: 0, dailyAdCap: freeAdCap(plans), rewardMultiplier: 1 }
  const rungs = ladder(plans)
    .filter((p) => p.priceGhs !== priceGhs)
    .sort((a, b) => a.priceGhs - b.priceGhs)

  const round = (m: number) => Math.round(m * 1000) / 1000

  if (rungs.length === 0) {
    return { dailyAdCap: free.dailyAdCap, rewardMultiplier: 1 }
  }

  const below = [free, ...rungs].filter((p) => p.priceGhs < priceGhs).pop() ?? free
  const above = rungs.find((p) => p.priceGhs > priceGhs) ?? null

  if (!above) {
    // Continue the last segment rather than inventing a slope.
    const previous = [free, ...rungs].filter((p) => p.priceGhs < below.priceGhs).pop() ?? free
    const span = below.priceGhs - previous.priceGhs
    if (span <= 0) return { dailyAdCap: below.dailyAdCap, rewardMultiplier: below.rewardMultiplier }
    const over = (priceGhs - below.priceGhs) / span
    return {
      dailyAdCap: Math.max(
        0,
        Math.round(below.dailyAdCap + (below.dailyAdCap - previous.dailyAdCap) * over),
      ),
      rewardMultiplier: round(
        below.rewardMultiplier + (below.rewardMultiplier - previous.rewardMultiplier) * over,
      ),
    }
  }

  const span = above.priceGhs - below.priceGhs
  const share = span <= 0 ? 0 : (priceGhs - below.priceGhs) / span
  return {
    dailyAdCap: Math.round(below.dailyAdCap + (above.dailyAdCap - below.dailyAdCap) * share),
    rewardMultiplier: round(
      below.rewardMultiplier + (above.rewardMultiplier - below.rewardMultiplier) * share,
    ),
  }
}

export type BandProblem = 'unbuyable' | 'earningInversion' | 'adsInversion'

export type BandCheck = {
  ok: boolean
  problems: BandProblem[]
  band: Band | null
  /** The plan the band ends against — named in every warning, because "the
   *  plan above" means nothing while looking at one row. */
  next: Rung | null
}

/**
 * Everything that can be wrong with where this plan sits in the ladder.
 *
 * A hidden plan and the free plan are not checked: neither is sold, so neither
 * has a band to be wrong about.
 */
export function checkBand(plan: Rung, plans: Rung[]): BandCheck {
  const band = bandFor(plan, plans)
  const next = nextRung(plan, plans)
  const problems: BandProblem[] = []

  if (band && !band.isTop && next) {
    if (band.empty) problems.push('unbuyable')
    if (next.rewardMultiplier < plan.rewardMultiplier) problems.push('earningInversion')
    if (next.dailyAdCap < plan.dailyAdCap) problems.push('adsInversion')
  }

  /* The top rung is checked against its OWN ceiling, which is the only thing
     it has to be wrong about. Same two failures, one rung: a range that runs
     backwards cannot be bought, and a top rate below the floor rate would mean
     paying more to earn less inside a single plan. */
  if (band && band.isTop && plan.ownBandMaxGhs != null) {
    if (band.empty) problems.push('unbuyable')
    if (plan.ownBandMaxMultiplier != null && plan.ownBandMaxMultiplier < plan.rewardMultiplier) {
      problems.push('earningInversion')
    }
  }

  return { ok: problems.length === 0, problems, band, next }
}

/**
 * Would this plan be beaten by a cheaper combination of other plans?
 *
 * Plans stack and their benefits add up, so this survived the move to bands
 * unchanged in spirit — but it now compares against FLOOR prices, because the
 * floor is what a combination really costs. Only pairs: that is where it
 * actually bit, and an exhaustive subset search over a handful of plans would
 * be more machinery than the warning is worth.
 */
export function undercutBy(
  plan: Rung,
  others: Rung[],
  free: number,
): { names: string[]; priceGhs: number; dailyAdCap: number; rewardMultiplier: number } | null {
  const candidates = ladder(others).filter((p) => p.id !== plan.id)

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!
      const b = candidates[j]!
      const priceGhs = a.priceGhs + b.priceGhs
      if (priceGhs >= plan.priceGhs) continue

      /* Stacking counts the free allowance ONCE and adds what each plan buys
         — the arithmetic `resolve_user_tier` does. Summing the raw caps would
         hand out the free allowance twice and overstate every combination. */
      const dailyAdCap = free + (a.dailyAdCap - free) + (b.dailyAdCap - free)
      const rewardMultiplier =
        Math.round((1 + (a.rewardMultiplier - 1) + (b.rewardMultiplier - 1)) * 1000) / 1000

      if (dailyAdCap > plan.dailyAdCap || rewardMultiplier > plan.rewardMultiplier) {
        return { names: [a.name, b.name], priceGhs, dailyAdCap, rewardMultiplier }
      }
    }
  }
  return null
}

/**
 * What one cedi buys at this rung, as a percentage on the earning rate.
 *
 * Shown, never judged. The ladder deliberately gives less per cedi as it goes
 * up, and this is how an operator sees that curve while pricing a new plan.
 */
export function earningPerCedi(plan: Rung): number {
  if (plan.priceGhs <= 0) return 0
  return Math.round(((plan.rewardMultiplier - 1) / plan.priceGhs) * 10000) / 100
}

/**
 * Temporary client-side id for a plan that has not been saved yet.
 *
 * A counter rather than Date.now() or randomUUID(): both are impure calls the
 * React compiler rightly refuses during render, and neither buys anything
 * here — the database assigns the real id on save, and this only has to be
 * unique within one session's unsaved rows.
 */
let draftSeq = 0
export function nextDraftPlanId(): string {
  draftSeq += 1
  return `draft-plan-${draftSeq}`
}

/** Slug suggestion from a name, matching the column's check constraint. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^([^a-z])/, 'p$1')
    .slice(0, 40)
}

/** The database's own constraints, mirrored so the form fails before the
 *  server does. Returns a field-keyed map of message ids, empty when valid. */
export function validatePlan(
  plan: Pick<
    PlanRow,
    | 'slug'
    | 'name'
    | 'priceGhs'
    | 'billingPeriodDays'
    | 'dailyAdCap'
    | 'rewardMultiplier'
    | 'redemptionMinimumPoints'
    | 'adPriority'
    | 'adCooldownSeconds'
    | 'isDefault'
  >,
  existingSlugs: string[],
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!/^[a-z][a-z0-9_-]*$/.test(plan.slug)) errors.slug = 'slugFormat'
  else if (existingSlugs.includes(plan.slug)) errors.slug = 'slugTaken'

  const name = plan.name.trim()
  if (name.length < 1 || name.length > 60) errors.name = 'nameLength'

  if (plan.priceGhs < 0) errors.priceGhs = 'negative'
  if (plan.billingPeriodDays < 1 || plan.billingPeriodDays > 3650) {
    errors.billingPeriodDays = 'periodRange'
  }
  if (plan.dailyAdCap < 0) errors.dailyAdCap = 'negative'
  if (plan.rewardMultiplier <= 0 || plan.rewardMultiplier > 100) {
    errors.rewardMultiplier = 'multiplierRange'
  }
  if (plan.redemptionMinimumPoints < 0) errors.redemptionMinimumPoints = 'negative'
  if (plan.adPriority < 0) errors.adPriority = 'negative'
  if (plan.adCooldownSeconds < 0) errors.adCooldownSeconds = 'negative'

  // constraint tiers_default_is_free
  if (plan.isDefault && plan.priceGhs > 0) errors.priceGhs = 'defaultMustBeFree'

  return errors
}
