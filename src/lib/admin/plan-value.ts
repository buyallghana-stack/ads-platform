import type { PlanRow } from './types'

/**
 * The rule that keeps "more money paid" meaning "more benefit".
 *
 * WHY THIS FILE EXISTS
 * Migration 037 (`value_per_cedi`) fixed an ordering bug where Bronze+Silver
 * at GHS 70 beat Gold at GHS 100, and it closes with an instruction:
 *
 *   "it holds only while every plan shares that value per cedi. If the admin
 *    dashboard later sets a plan's benefits out of proportion to its price,
 *    the ordering can break again. That rule belongs on the admin plan editor
 *    when it is built."
 *
 * This is that rule. Plans stack, and stacking adds up what each plan BUYS on
 * top of the free allowance — so as long as every plan is priced at the same
 * value per cedi, any combination lands on the same straight line and no
 * combination can be gamed. Break the line on one plan and the guarantee is
 * gone platform-wide, not just for that plan.
 *
 * The line the seeded plans sit on:
 *
 *   daily ads   = free allowance + price × 0.5
 *   rate        = 1 + price × 0.005          (so GHS 1 buys +0.5%)
 *
 *     Bronze    GHS  20  →  30 ads,  ×1.10
 *     Silver    GHS  50  →  45 ads,  ×1.25
 *     Gold      GHS 100  →  70 ads,  ×1.50
 *     Platinum  GHS 200  → 120 ads,  ×2.00
 *
 * Pure functions only. The editor uses them to warn and to offer a fix; it
 * does not block a deliberate change, because the operator may genuinely want
 * a promotional plan and is entitled to overrule a warning they understand.
 */

export type HouseRate = {
  /** Ads per day bought by one cedi. */
  adsPerCedi: number
  /** Added to the multiplier by one cedi. 0.005 = +0.5% per GHS 1. */
  ratePerCedi: number
  /** Ads per day everyone gets without paying — the free tier's cap. */
  freeAdCap: number
}

/**
 * Work the house rate out from the plans themselves rather than hard-coding
 * it, so that if the operator deliberately re-prices the whole ladder the
 * editor follows them instead of nagging forever about the old numbers.
 *
 * The free tier sets the baseline; the paid plans vote on the slope, and the
 * median wins so that one plan already out of line cannot drag the rate it is
 * about to be measured against.
 */
export function houseRate(plans: PlanRow[]): HouseRate {
  const free = plans.find((p) => p.isDefault) ?? plans.find((p) => p.priceGhs === 0)
  const freeAdCap = free?.dailyAdCap ?? 20

  const paid = plans.filter((p) => p.priceGhs > 0)
  if (paid.length === 0) return { adsPerCedi: 0.5, ratePerCedi: 0.005, freeAdCap }

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
  }

  return {
    adsPerCedi: median(paid.map((p) => (p.dailyAdCap - freeAdCap) / p.priceGhs)),
    ratePerCedi: median(paid.map((p) => (p.rewardMultiplier - 1) / p.priceGhs)),
    freeAdCap,
  }
}

/** What this price should buy, if the plan sits on the line. */
export function alignedBenefits(priceGhs: number, rate: HouseRate) {
  return {
    dailyAdCap: Math.round(rate.freeAdCap + priceGhs * rate.adsPerCedi),
    // Three decimals is what the column stores.
    rewardMultiplier: Math.round((1 + priceGhs * rate.ratePerCedi) * 1000) / 1000,
  }
}

export type ValueCheck = {
  aligned: boolean
  /** Signed difference against the line: positive means over-generous. */
  adsDelta: number
  rateDelta: number
  expected: { dailyAdCap: number; rewardMultiplier: number }
}

/**
 * Is this plan on the line?
 *
 * The free plan is exempt — it defines the baseline rather than sitting on
 * the slope, and dividing its benefits by a price of zero is meaningless.
 *
 * Tolerances are one whole ad and 0.005 on the multiplier: rounding a
 * multiplier to three decimals must not be reported as a policy breach.
 */
export function checkPlanValue(
  plan: Pick<PlanRow, 'priceGhs' | 'dailyAdCap' | 'rewardMultiplier'>,
  rate: HouseRate,
): ValueCheck {
  const expected = alignedBenefits(plan.priceGhs, rate)
  const adsDelta = plan.dailyAdCap - expected.dailyAdCap
  const rateDelta = Math.round((plan.rewardMultiplier - expected.rewardMultiplier) * 1000) / 1000

  return {
    aligned: plan.priceGhs === 0 || (Math.abs(adsDelta) <= 1 && Math.abs(rateDelta) <= 0.005),
    adsDelta,
    rateDelta,
    expected,
  }
}

/**
 * Would this plan be beaten by a cheaper combination of other plans?
 *
 * The concrete harm the rule prevents, stated in the operator's terms rather
 * than as a slope: "Bronze + Silver costs GHS 70 and gives more than this
 * GHS 100 plan". Only checks pairs — that is where it actually bit, and an
 * exhaustive subset search over a handful of plans would be more machinery
 * than the warning is worth.
 */
export function undercutBy(
  plan: Pick<PlanRow, 'id' | 'priceGhs' | 'dailyAdCap' | 'rewardMultiplier'>,
  others: PlanRow[],
  rate: HouseRate,
): { names: string[]; priceGhs: number; dailyAdCap: number; rewardMultiplier: number } | null {
  const candidates = others.filter((p) => p.id !== plan.id && p.priceGhs > 0 && p.status === 'live')

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!
      const b = candidates[j]!
      const priceGhs = a.priceGhs + b.priceGhs
      if (priceGhs >= plan.priceGhs) continue

      /* Stacking counts the free allowance ONCE and adds what each plan buys
         — the arithmetic migration 037 introduced. Summing the raw caps would
         hand out the free allowance twice and overstate every combination. */
      const dailyAdCap =
        rate.freeAdCap + (a.dailyAdCap - rate.freeAdCap) + (b.dailyAdCap - rate.freeAdCap)
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
    | 'referralBonusMultiplier'
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
  if (plan.referralBonusMultiplier <= 0 || plan.referralBonusMultiplier > 100) {
    errors.referralBonusMultiplier = 'multiplierRange'
  }
  if (plan.adPriority < 0) errors.adPriority = 'negative'
  if (plan.adCooldownSeconds < 0) errors.adCooldownSeconds = 'negative'

  // constraint tiers_default_is_free
  if (plan.isDefault && plan.priceGhs > 0) errors.priceGhs = 'defaultMustBeFree'

  return errors
}
