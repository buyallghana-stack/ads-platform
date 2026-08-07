/**
 * The programme-wide recruiting share.
 *
 * In its own module, with no `server-only` import, for one reason: it is pure
 * arithmetic that decides what a compliance report claims, so it has to be
 * unit-testable without a database or a server context. `data/affiliates.ts`
 * re-exports it so callers do not have to know that.
 */

/** Just the fields the share needs, so a test fixture is four numbers. */
export type ShareInput = {
  productMinor: number
  trainingMinor: number
  totalMinor: number
  recruits: number
}

/**
 * The programme-wide split, from the per-affiliate rows.
 *
 * ⚠️ IT IS A RATIO OF TOTALS, NEVER AN AVERAGE OF THE PERCENTAGES. Those are
 * different numbers and the difference is not small: one affiliate earning
 * GHS 10 entirely from recruiting, beside one earning GHS 990 entirely from
 * products, averages to 50% while the programme's actual recruiting share is
 * 1%. On a small population that mistake would report a business as something
 * it is not, in the one report written to be shown to somebody who asks.
 *
 * Pure, exported and unit-tested for exactly that reason.
 */
export function programmeShare(rows: ShareInput[]): {
  productMinor: number
  trainingMinor: number
  totalMinor: number
  recruits: number
  sharePct: number
} {
  const totals = rows.reduce(
    (acc, r) => ({
      productMinor: acc.productMinor + r.productMinor,
      trainingMinor: acc.trainingMinor + r.trainingMinor,
      totalMinor: acc.totalMinor + r.totalMinor,
      recruits: acc.recruits + r.recruits,
    }),
    { productMinor: 0, trainingMinor: 0, totalMinor: 0, recruits: 0 },
  )

  return {
    ...totals,
    sharePct: totals.totalMinor === 0 ? 0 : (totals.trainingMinor / totals.totalMinor) * 100,
  }
}
