import { describe, expect, it } from 'vitest'

/* Relative, not `@/`: vitest here has no path alias, which is why every
   other test in this folder imports `../support/db` the same way. */
import { programmeShare, type ShareInput } from '../../src/lib/admin/promotion-share'

/**
 * The one figure the promotion report exists to state.
 *
 * `admin_affiliate_promotion_report` is well covered in `reports.test.ts`; what
 * is tested here is the arithmetic the SCREEN adds on top of it, because that
 * is code I wrote and because the wrong version of it is so easy to write.
 *
 * No database: this is a pure function, deliberately, so that the distinction
 * below can be asserted in milliseconds and can never be quietly re-derived
 * inside a component.
 */

const row = (over: Partial<ShareInput & { sharePct: number }>): ShareInput => ({
  productMinor: 0,
  trainingMinor: 0,
  totalMinor: 0,
  recruits: 0,
  ...over,
})

describe('the programme-wide recruiting share', () => {
  it('is a ratio of totals, NOT the mean of the individual percentages', () => {
    /* The case that separates the two: one small affiliate earning entirely
       from recruiting, one large one earning entirely from products. Averaging
       the percentages says 50%. The truth is 1%. */
    const rows = [
      { productMinor: 0, trainingMinor: 1_000, totalMinor: 1_000, recruits: 1 },
      { productMinor: 99_000, trainingMinor: 0, totalMinor: 99_000, recruits: 0 },
    ]

    /* Their individual shares are 100% and 0%, which averages to 50%. */
    const naiveAverage = (100 + 0) / 2
    expect(naiveAverage).toBe(50)
    expect(programmeShare(rows).sharePct).toBeCloseTo(1, 5)
  })

  it('adds up the money and the recruits', () => {
    const rows = [
      row({ productMinor: 5_000, trainingMinor: 5_000, totalMinor: 10_000, recruits: 2 }),
      row({ productMinor: 0, trainingMinor: 10_000, totalMinor: 10_000, recruits: 3 }),
    ]

    const share = programmeShare(rows)
    expect(share.productMinor).toBe(5_000)
    expect(share.trainingMinor).toBe(15_000)
    expect(share.totalMinor).toBe(20_000)
    expect(share.recruits).toBe(5)
    expect(share.sharePct).toBeCloseTo(75, 5)
  })

  it('reports zero rather than dividing by nothing', () => {
    /* An empty programme is the state this screen ships in, so the boring case
       is the one that must not throw. */
    expect(programmeShare([]).sharePct).toBe(0)
    expect(programmeShare([row({})]).sharePct).toBe(0)
  })

  it('survives a window in which reversals outweigh the credits', () => {
    /* `admin_affiliate_promotion_report` is net of reversals, so a total can
       come back negative. The share is still arithmetic, and it must not
       become NaN or Infinity on a screen somebody is reading. */
    const rows = [row({ trainingMinor: -5_000, productMinor: 1_000, totalMinor: -4_000 })]
    const share = programmeShare(rows)

    expect(Number.isFinite(share.sharePct)).toBe(true)
    expect(share.totalMinor).toBe(-4_000)
  })
})
