import { describe, expect, it } from 'vitest'

import { ladderFaults, ladderPoints, type LadderStep } from '@/lib/admin/plan-value'

import { HAS_DB, type LadderRung, pinLadder, type Tx, withRollback } from '../support/db'

/**
 * Paying more must never buy less. The operator's rule, as a test.
 *
 * *"The number one rule is that more is equal to better."* On 2026-09-19 a
 * proposed ladder broke it at all five rung boundaries at once, on three
 * columns at once, and nothing in the repo noticed: the arithmetic inside each
 * plan was self-consistent, the admin screen's own warning compared a plan's
 * FLOOR rate to the next plan's floor rate rather than its CEILING rate, and no
 * test read the finished ladder end to end.
 *
 * ⚠️ THE FIRST TWO CASES RUN WITHOUT A DATABASE, ON PURPOSE. Every other file
 * in this directory is `describe.skipIf(!HAS_DB)`, so a run with no
 * `SUPABASE_DB_URL` reports green while proving nothing. The rule itself is
 * pure arithmetic and has no business being unprovable on a laptop, so the
 * fixtures below always run and only the live-ladder case is gated.
 */

/** A ladder in the shape `ladderFaults` reads, with the fields it ignores
 *  filled in once. Prices and rates are the argument; the rest is scaffolding. */
function steps(
  rows: [name: string, floor: number, ceiling: number, ads: number, days: number, rate: number, topRate: number][],
): LadderStep[] {
  return rows.map(([name, floor, ceiling, ads, days, rate, topRate], i) => ({
    id: `rung-${i}`,
    name,
    priceGhs: floor,
    dailyAdCap: ads,
    rewardMultiplier: rate,
    sortOrder: i + 1,
    status: 'live' as const,
    isDefault: false,
    ownBandMaxGhs: ceiling,
    ownBandMaxMultiplier: topRate,
    billingPeriodDays: days,
  }))
}

/* The ladder that shipped on 2026-09-19. Two decimal rates deliberately: an ad
   pays `floor(100 x rate)`, so 2 dp loses nothing between card and ledger. */
const SHIPPED = steps([
  ['Bronze', 85, 105, 3, 39, 1.45, 1.8],
  ['Silver', 145, 180, 4, 43, 1.87, 2.33],
  ['Pearl', 230, 285, 5, 46, 2.39, 2.97],
  ['Gold', 400, 500, 7, 50, 2.98, 3.73],
  ['Sapphire', 720, 900, 10, 53, 3.78, 4.73],
  ['Platinum', 1180, 1500, 13, 57, 4.78, 6.08],
])

/* The operator's first draft, kept because it is the only ladder anybody has
   actually written that breaks the rule, and a guard with no failing case is
   a guard nobody has seen work. Same prices, same caps, same lengths: the only
   difference is a rate that climbs steeply INSIDE each band. */
const THE_DRAFT = steps([
  ['Bronze', 85, 105, 3, 39, 1.45, 2.06],
  ['Silver', 145, 180, 4, 43, 1.83, 2.58],
  ['Pearl', 230, 285, 5, 46, 2.28, 3.2],
  ['Gold', 400, 500, 7, 50, 2.8, 3.93],
  ['Sapphire', 720, 900, 10, 53, 3.46, 4.84],
  ['Platinum', 1180, 1500, 13, 57, 4.3, 6.07],
])

describe('paying more, on the ladder that shipped', () => {
  it('reads twelve prices, floor and ceiling of every band', () => {
    const points = ladderPoints(SHIPPED)
    expect(points).toHaveLength(12)
    expect(points[0]).toMatchObject({ label: 'Bronze floor', priceGhs: 85, perAd: 145 })
    expect(points[11]).toMatchObject({ label: 'Platinum ceiling', priceGhs: 1500, perAd: 608 })
  })

  it('never buys less at a higher price', () => {
    const faults = ladderFaults(SHIPPED)
    const readable = faults.map(
      (f) => `GHS ${f.from.priceGhs} (${f.from.label}) to GHS ${f.to.priceGhs} (${f.to.label}): ${f.broke.join(', ')}`,
    )
    expect(readable).toEqual([])
  })

  it('rises on all three promises at every step', () => {
    const points = ladderPoints(SHIPPED)
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]!.perAd).toBeGreaterThan(points[i - 1]!.perAd)
      expect(points[i]!.multiple).toBeGreaterThanOrEqual(points[i - 1]!.multiple - 1e-9)
      expect(points[i]!.paybackDays).toBeLessThanOrEqual(points[i - 1]!.paybackDays + 1e-9)
    }
  })
})

describe('the draft that broke the rule', () => {
  it('is caught, once at every rung boundary', () => {
    const faults = ladderFaults(THE_DRAFT)
    expect(faults).toHaveLength(5)
    expect(faults.map((f) => `${f.from.label} to ${f.to.label}`)).toEqual([
      'Bronze ceiling to Silver floor',
      'Silver ceiling to Pearl floor',
      'Pearl ceiling to Gold floor',
      'Gold ceiling to Sapphire floor',
      'Sapphire ceiling to Platinum floor',
    ])
  })

  it('names all three broken promises, not just the cheapest to spot', () => {
    for (const fault of ladderFaults(THE_DRAFT)) {
      expect(fault.broke).toEqual(['perAd', 'multiple', 'payback'])
    }
  })

  it('is the only thing wrong with it: inside a band it is still fine', () => {
    /* Bronze alone passes. The draft's fault is never visible from one plan,
       which is why `checkBand` on its own could not have found it. */
    expect(ladderFaults(THE_DRAFT.slice(0, 1))).toEqual([])
  })
})

describe.skipIf(!HAS_DB)('the ladder, through the database', () => {
  /*
    ⚠️ PINNED, NEVER READ. The suite shares one database with every other file
    and with whatever the operator last tuned, so asserting against the live
    `tiers` table asserts a property of whatever happens to be sitting there.
    It is not hypothetical: the test project still carries a `diamond` rung
    that production deleted, at a `sort_order` that COLLIDES with Sapphire's,
    and bands are cut by `lead(...) over (order by sort_order)`. Reading that
    table gave four faults that say nothing about the ladder being sold.

    `pinLadder` switches off every rung it is not given, which is how the stale
    one stops mattering. It writes 30 days for all of them, so the lengths are
    set afterwards: payback does not depend on length, but the return does.
  */
  const rungs: LadderRung[] = SHIPPED.map((step) => ({
    slug: step.name.toLowerCase(),
    name: step.name,
    priceGhs: step.priceGhs,
    multiplier: step.rewardMultiplier,
    dailyAdCap: step.dailyAdCap,
    bandMaxGhs: step.ownBandMaxGhs ?? undefined,
    bandMaxMultiplier: step.ownBandMaxMultiplier ?? undefined,
  }))

  const pin = async (tx: Tx) => {
    await pinLadder(tx, { rungs: [{ slug: 'free', name: 'Free', priceGhs: 0, multiplier: 1, dailyAdCap: 1 }, ...rungs] })
    await tx.query(
      `update public.tiers t set billing_period_days = v.days
         from (select unnest($1::text[]) as slug, unnest($2::int[]) as days) v
        where t.slug = v.slug`,
      [SHIPPED.map((s) => s.name.toLowerCase()), SHIPPED.map((s) => s.billingPeriodDays)],
    )
  }

  it('pays, through plan_multiplier_for_amount, exactly what the sweep says', async () => {
    await withRollback(async (tx: Tx) => {
      await pin(tx)

      /* The sweep reads a plan's columns. This reads the function that decides
         what an ad is actually worth. If they disagree the rule is being
         proved against numbers nobody is paid. */
      for (const point of ladderPoints(SHIPPED)) {
        const { rows } = await tx.query<{ rate: string }>(
          `select public.plan_multiplier_for_amount($1::bigint)::text as rate`,
          [Math.round(point.priceGhs * 100)],
        )
        const paidByDatabase = Math.floor(100 * Number(rows[0]!.rate))
        expect({ price: point.priceGhs, perAd: paidByDatabase }).toEqual({
          price: point.priceGhs,
          perAd: point.perAd,
        })
      }
    })
  })

  it('never pays less an ad for more money, at any price the database will take', async () => {
    await withRollback(async (tx: Tx) => {
      await pin(tx)

      /*
        Not just the twelve band ends: every whole cedi inside every band,
        priced by Postgres. A rule that only holds at the corners is not the
        rule, and interpolation is where a rounding would hide.

        ⚠️ POINTS AN AD, NOT PAYBACK, AT THIS GRANULARITY. An ad pays
        `floor(base x rate)` and the rate moves in thousandths, so points move
        in whole steps while the price moves smoothly. Between two steps an
        extra cedi buys the same points as the last one, and payback therefore
        ticks UP by a few minutes. That is discretisation, not a broken ladder,
        and asserting payback here would only ever be satisfied by a rate with
        no steps in it, which does not exist. Payback is checked where the
        rates are exact: at the band ends, in the fixture cases above.
      */
      const { rows } = await tx.query<{ slug: string; minor: string; rate: string }>(
        `select t.slug, p.minor::text, public.plan_multiplier_for_amount(p.minor)::text as rate
           from public.tiers t
           cross join lateral generate_series(t.price_minor, t.band_max_minor, 100) as p(minor)
          where t.is_active and not t.is_default
          order by p.minor`,
      )

      expect(rows.length).toBeGreaterThan(700)

      const faults: string[] = []
      let previous: { minor: number; perAd: number } | null = null

      for (const row of rows) {
        const minor = Number(row.minor)
        const perAd = Math.max(Math.floor(100 * Number(row.rate)), 1)
        if (previous && perAd < previous.perAd) {
          faults.push(`GHS ${previous.minor / 100} paid ${previous.perAd} an ad, GHS ${minor / 100} pays ${perAd}`)
        }
        previous = { minor, perAd }
      }

      expect(faults).toEqual([])
    })
  })

  it('leaves no long stretch of cedis that buy nothing at all', async () => {
    await withRollback(async (tx: Tx) => {
      await pin(tx)

      /*
        The other half of discretisation, and the half that CAN go wrong. A
        band gains a fixed number of points across its width, so the wider the
        band the more cedis buy no extra point: Bronze, Silver and Pearl have
        none at all, Gold has 25 of 100 and Platinum 190 of 320. At worst two
        cedis in a row currently buy nothing.

        Two is tolerable. A ladder that let a buyer pay ten cedis more for
        nothing would be the rule breaking in the way a buyer would actually
        notice, so the length of that stretch is pinned rather than left to
        drift with the next retune.
      */
      const { rows } = await tx.query<{ slug: string; minor: string; rate: string }>(
        `select t.slug, p.minor::text, public.plan_multiplier_for_amount(p.minor)::text as rate
           from public.tiers t
           cross join lateral generate_series(t.price_minor, t.band_max_minor, 100) as p(minor)
          where t.is_active and not t.is_default
          order by t.sort_order, p.minor`,
      )

      const worst = new Map<string, number>()
      let run = 0
      let previous: { slug: string; perAd: number } | null = null

      for (const row of rows) {
        const perAd = Math.max(Math.floor(100 * Number(row.rate)), 1)
        run = previous && previous.slug === row.slug && perAd === previous.perAd ? run + 1 : 0
        worst.set(row.slug, Math.max(worst.get(row.slug) ?? 0, run))
        previous = { slug: row.slug, perAd }
      }

      for (const [slug, longest] of worst) {
        expect({ slug, longest }).toEqual({ slug, longest: expect.any(Number) })
        expect(longest, `${slug} has ${longest} cedis in a row that buy no extra point`).toBeLessThanOrEqual(2)
      }
    })
  })
})
