/**
 * Commission money.
 *
 * Phase 2 deals in real cedis; Phase 1 deals in points that reach cedis only
 * through a peg. D27 says the two never mix, and the most likely way that rule
 * gets broken is not somebody deliberately summing them — it is two numbers
 * sitting next to each other in the same shape, both reading as "1,240", until
 * somebody adds them.
 *
 * So the two are given deliberately different SHAPES, and this is the half
 * that renders cedis:
 *
 *     commission   GHS 1,240.50     prefix, always two decimals
 *     points       12,405 pts       suffix, never any decimals
 *
 * Different position, different glyph, different precision. They cannot be
 * mistaken for one another at a glance, which is the only protection that
 * works on a screen somebody is reading quickly.
 *
 * Minor units in, string out. Nothing in Phase 2 stores a major-unit amount,
 * and every rounding bug in a money system starts with a float that was
 * converted too early.
 */

/** `GHS 1,240.50`. Negative amounts keep the sign in front of the number:
 *  `-GHS 40.00`, never `GHS -40.00`, which reads as a typo. */
export function cedis(minor: number): string {
  const negative = minor < 0
  const major = Math.abs(minor) / 100
  const body = major.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${negative ? '-' : ''}GHS ${body}`
}

/**
 * Earnings per click, as a cedi string, or `null` when there are no clicks.
 *
 * `null` rather than `GHS 0.00`, because the two mean different things and the
 * screen should say so: zero earnings on 400 clicks is a problem worth showing,
 * while zero clicks is simply nothing to divide by. Printing GHS 0.00 for the
 * second makes a new affiliate look like a failing one.
 */
export function earningsPerClick(earnedMinor: number, clicks: number): string | null {
  if (clicks <= 0) return null
  return cedis(Math.round(earnedMinor / clicks))
}

/**
 * Conversion rate as a percentage string, or `null` when there are no clicks.
 *
 * One decimal place: a rate of 0.4% and one of 0% are a real difference to
 * somebody promoting, and whole numbers hide it.
 */
export function conversionRate(conversions: number, clicks: number): string | null {
  if (clicks <= 0) return null
  return `${((conversions / clicks) * 100).toFixed(1)}%`
}
