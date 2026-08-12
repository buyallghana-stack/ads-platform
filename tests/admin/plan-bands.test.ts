import { describe, expect, it } from 'vitest'

import {
  bandFor,
  benefitsBetween,
  checkBand,
  earningPerCedi,
  freeAdCap,
  ladder,
  undercutBy,
  type Rung,
} from '../../src/lib/admin/plan-value'
import { HAS_DB, withRollback } from '../support/db'

/**
 * The rules the admin plans screen warns by.
 *
 * These are pure functions, so most of this needs no database — but the last
 * block does, and it is the important one: the band rule exists TWICE, once in
 * `plan_band_max_minor` where it is enforced and once here where it is drawn.
 * Two implementations of one rule drift, and the way this one would drift is
 * silent — a screen promising a range the server refuses. So the last test
 * makes the database and this file agree on the real ladder, plan by plan.
 *
 * The trap it exists for: the SQL cuts bands with
 * `lead(price_minor) over (order by sort_order)`. Sort ORDER, not price. A
 * plan that sorts after a cheaper one ends its band below its own floor and
 * quietly becomes unsellable, and nothing about its own row looks wrong.
 */

const rung = (over: Partial<Rung> & { id: string }): Rung => ({
  name: over.id,
  priceGhs: 0,
  dailyAdCap: 1,
  rewardMultiplier: 1,
  sortOrder: 0,
  status: 'live',
  isDefault: false,
  ...over,
})

/** The live ladder, as of 2026-08-05. */
const LADDER: Rung[] = [
  rung({ id: 'free', name: 'Free', priceGhs: 0, dailyAdCap: 1, rewardMultiplier: 1, sortOrder: 0, isDefault: true }),
  rung({ id: 'bronze', name: 'Bronze', priceGhs: 65, dailyAdCap: 3, rewardMultiplier: 1.5, sortOrder: 1 }),
  rung({ id: 'silver', name: 'Silver', priceGhs: 140, dailyAdCap: 5, rewardMultiplier: 2, sortOrder: 2 }),
  rung({ id: 'gold', name: 'Gold', priceGhs: 250, dailyAdCap: 7, rewardMultiplier: 2.5, sortOrder: 3 }),
  rung({ id: 'platinum', name: 'Platinum', priceGhs: 520, dailyAdCap: 12, rewardMultiplier: 3, sortOrder: 4 }),
  rung({ id: 'diamond', name: 'Diamond', priceGhs: 1000, dailyAdCap: 15, rewardMultiplier: 3.5, sortOrder: 5 }),
]

const find = (id: string) => LADDER.find((p) => p.id === id)!

describe('what a plan may be paid', () => {
  it('runs from its own price to one pesewa under the next', () => {
    expect(bandFor(find('bronze'), LADDER)).toMatchObject({ fromGhs: 65, toGhs: 139.99 })
    expect(bandFor(find('gold'), LADDER)).toMatchObject({ fromGhs: 250, toGhs: 519.99 })
  })

  it('is one exact price at the top, where there is nothing to slide towards', () => {
    expect(bandFor(find('diamond'), LADDER)).toMatchObject({
      fromGhs: 1000,
      toGhs: 1000,
      isTop: true,
    })
  })

  it('does not exist for the free plan or a hidden one', () => {
    expect(bandFor(find('free'), LADDER)).toBeNull()
    const hidden = { ...find('gold'), status: 'hidden' as const }
    expect(bandFor(hidden, LADDER)).toBeNull()
  })

  it('ends against the next plan a buyer can actually reach, skipping hidden ones', () => {
    /* A hidden plan is not on sale, so it cannot be what a band ends at —
       otherwise taking Silver off sale would leave a dead range between
       Bronze's ceiling and Gold's floor that nobody could pay into. */
    const withHiddenSilver = LADDER.map((p) =>
      p.id === 'silver' ? { ...p, status: 'hidden' as const } : p,
    )
    expect(bandFor(find('bronze'), withHiddenSilver)).toMatchObject({ toGhs: 249.99 })
  })
})

describe('the three ways a rung is wrong', () => {
  it('is happy with the real ladder', () => {
    for (const plan of ladder(LADDER)) {
      expect({ plan: plan.name, problems: checkBand(plan, LADDER).problems }).toEqual({
        plan: plan.name,
        problems: [],
      })
    }
  })

  it('catches a plan nobody can buy', () => {
    /* Priced at or above the plan that sorts directly above it: the band has
       nothing in it, and `start_subscription_payment` refuses every amount. */
    const broken = { ...find('bronze'), priceGhs: 200 }
    const check = checkBand(broken, [...LADDER.filter((p) => p.id !== 'bronze'), broken])
    expect(check.problems).toContain('unbuyable')
    expect(check.next?.name).toBe('Silver')
  })

  it('catches a rate that falls as the price rises', () => {
    // Silver earning less than Bronze makes Bronze's own band descend.
    const silver = { ...find('silver'), rewardMultiplier: 1.2 }
    const plans = [...LADDER.filter((p) => p.id !== 'silver'), silver]
    expect(checkBand(find('bronze'), plans).problems).toContain('earningInversion')
  })

  it('catches an ad count that falls as the price rises', () => {
    const silver = { ...find('silver'), dailyAdCap: 2 }
    const plans = [...LADDER.filter((p) => p.id !== 'silver'), silver]
    expect(checkBand(find('bronze'), plans).problems).toContain('adsInversion')
  })

  it('says nothing about the free plan or a hidden one', () => {
    expect(checkBand(find('free'), LADDER).problems).toEqual([])
    const hidden = { ...find('gold'), status: 'hidden' as const, priceGhs: 9_999 }
    expect(checkBand(hidden, [...LADDER, hidden]).problems).toEqual([])
  })
})

describe('filling a new plan in from its neighbours', () => {
  it('puts a price between two plans on the line between them', () => {
    // Halfway between Bronze (GHS 65, ×1.5) and Silver (GHS 140, ×2.0).
    const mid = benefitsBetween((65 + 140) / 2, LADDER)
    expect(mid.rewardMultiplier).toBe(1.75)
    expect(mid.dailyAdCap).toBe(4)
  })

  it('runs the line up from Free below the cheapest plan', () => {
    const cheap = benefitsBetween(32.5, LADDER) // half of Bronze
    expect(cheap.rewardMultiplier).toBe(1.25)
  })

  it('keeps the rate continuous across the boundary it creates', () => {
    /* The reason this is the right default and not merely a tidy one: a rung
       placed on the line leaves what a buyer earns unchanged at the price
       where the new band begins. */
    const price = 100
    const filled = benefitsBetween(price, LADDER)
    const bronze = find('bronze')
    const silver = find('silver')
    const onOldLine =
      bronze.rewardMultiplier +
      ((silver.rewardMultiplier - bronze.rewardMultiplier) * (price - bronze.priceGhs)) /
        (silver.priceGhs - bronze.priceGhs)
    expect(filled.rewardMultiplier).toBeCloseTo(onOldLine, 3)
  })
})

describe('a cheaper pair that beats a dearer plan', () => {
  it('names the pair, because plans stack and their benefits add up', () => {
    /* Silver + Gold costs GHS 390 against Platinum's GHS 520 and earns at
       ×3.5 against its ×3.0. That is a real property of the ladder the
       operator chose — per-cedi value falls as it climbs, while stacking adds
       up in a straight line — and the screen says so rather than hiding it. */
    const beaten = undercutBy(find('platinum'), LADDER, freeAdCap(LADDER))
    expect(beaten).not.toBeNull()
    expect(beaten!.names.sort()).toEqual(['Gold', 'Silver'])
    expect(beaten!.priceGhs).toBe(390)
    expect(beaten!.rewardMultiplier).toBe(3.5)
  })

  it('counts the free allowance once, not once per plan', () => {
    const free = freeAdCap(LADDER)
    const beaten = undercutBy(find('platinum'), LADDER, free)
    // 1 free + (5-1) + (7-1) = 11, not 5 + 7 = 12.
    expect(beaten!.dailyAdCap).toBe(free + 4 + 6)
  })

  it('says nothing when a cheaper pair only MATCHES the plan', () => {
    /* Bronze + Silver reaches Gold's exact rate and ad count for GHS 205
       against GHS 250. Strictly-better is the bar on purpose: "the same, for
       less" is a pricing judgement, and firing on every equal pair would put
       a warning on most of the ladder and teach the operator to ignore it. */
    expect(undercutBy(find('gold'), LADDER, freeAdCap(LADDER))).toBeNull()
  })

  it('has nothing to say about the cheapest plan', () => {
    expect(undercutBy(find('bronze'), LADDER, freeAdCap(LADDER))).toBeNull()
  })
})

describe('what a cedi buys', () => {
  it('falls as the ladder climbs, which is the shape the operator chose', () => {
    const rates = ladder(LADDER).map(earningPerCedi)
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]!).toBeLessThan(rates[i - 1]!)
    }
  })
})

describe.skipIf(!HAS_DB)('and the database agrees', () => {
  it('cuts every band exactly where plan_band_max_minor does', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query<{
        id: string
        name: string
        price_ghs: string
        band_max_ghs: string | null
        daily_ad_cap: number
        reward_multiplier: string
        sort_order: number
        is_active: boolean
        is_default: boolean
        own_band_max_ghs: string | null
        own_band_max_multiplier: string | null
      }>(
        `select t.id, t.name, (t.price_minor / 100.0)::text as price_ghs,
                case when t.is_default or not t.is_active then null
                     else (public.plan_band_max_minor(t.id) / 100.0)::text end as band_max_ghs,
                t.daily_ad_cap, t.reward_multiplier::text, t.sort_order, t.is_active, t.is_default,
                (t.band_max_minor / 100.0)::text as own_band_max_ghs,
                t.band_max_multiplier::text as own_band_max_multiplier
           from public.tiers t order by t.sort_order`,
      )

      const plans: Rung[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        priceGhs: Number(r.price_ghs),
        dailyAdCap: r.daily_ad_cap,
        rewardMultiplier: Number(r.reward_multiplier),
        sortOrder: r.sort_order,
        status: r.is_active ? 'live' : 'hidden',
        isDefault: r.is_default,
        /* The top rung's own ceiling, carried exactly as `getPlans` carries
           it. Left out, this comparison quietly asks whether the two agree
           about a Platinum that stops at its floor — and they do, which is
           how a missing field passes for a passing test. */
        ownBandMaxGhs: r.own_band_max_ghs === null ? null : Number(r.own_band_max_ghs),
        ownBandMaxMultiplier:
          r.own_band_max_multiplier === null ? null : Number(r.own_band_max_multiplier),
      }))

      let compared = 0
      for (const row of rows) {
        const plan = plans.find((p) => p.id === row.id)!
        const mine = bandFor(plan, plans)
        expect({ plan: plan.name, top: mine === null ? null : mine.toGhs }).toEqual({
          plan: plan.name,
          top: row.band_max_ghs === null ? null : Number(row.band_max_ghs),
        })
        compared += 1
      }
      expect(compared).toBeGreaterThan(1)
    })
  })

  it('agrees after a plan is taken off sale, where the two could disagree', async () => {
    await withRollback(async (tx) => {
      /* Hiding a plan removes it from the ladder the bands are cut from, and
         the plan BELOW it must stretch past it. This is the case a client-side
         rule is most likely to get wrong, so it is checked against the real
         function rather than reasoned about. */
      await tx.query(`update public.tiers set is_active = false where slug = 'silver'`)

      const { rows } = await tx.query<{
        slug: string
        band_max_ghs: string | null
        own_band_max_ghs: string | null
        price_ghs: string
        daily_ad_cap: number
        reward_multiplier: string
        sort_order: number
        is_active: boolean
        is_default: boolean
        id: string
        name: string
      }>(
        `select t.id, t.slug, t.name, (t.price_minor / 100.0)::text as price_ghs,
                case when t.is_default or not t.is_active then null
                     else (public.plan_band_max_minor(t.id) / 100.0)::text end as band_max_ghs,
                case when t.band_max_minor is null then null
                     else (t.band_max_minor / 100.0)::text end as own_band_max_ghs,
                t.daily_ad_cap, t.reward_multiplier::text, t.sort_order, t.is_active, t.is_default
           from public.tiers t order by t.sort_order`,
      )

      /* ⚠️ `ownBandMaxGhs` HAS TO BE HANDED OVER (migration 189). Every rung
         carries its own ceiling now, and a Rung built without one sends the
         client-side rule back to "one pesewa below the next plan" — which is
         exactly the disagreement this test exists to catch. The admin screens
         pass it; this fixture did not, and said so by failing. */
      const plans: Rung[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        priceGhs: Number(r.price_ghs),
        ownBandMaxGhs: r.own_band_max_ghs === null ? null : Number(r.own_band_max_ghs),
        dailyAdCap: r.daily_ad_cap,
        rewardMultiplier: Number(r.reward_multiplier),
        sortOrder: r.sort_order,
        status: r.is_active ? 'live' : 'hidden',
        isDefault: r.is_default,
      }))

      /* Every rung, not just Bronze: hiding a plan changes what the ones
         around it are cut against, and the two implementations have to agree
         about all of them. */
      for (const row of rows) {
        if (row.band_max_ghs === null) continue
        const mine = bandFor(plans.find((p) => p.id === row.id)!, plans)
        expect([row.slug, mine!.toGhs]).toEqual([row.slug, Number(row.band_max_ghs)])
      }

      /* And the behaviour that changed with the gaps: a rung with a ceiling of
         its own does NOT stretch when the plan above it is hidden. Bronze
         sells GHS 85 to 105 whether or not Silver is on sale, because 105 is
         Bronze's own number rather than a fact about Silver. */
      const bronze = rows.find((r) => r.slug === 'bronze')!
      if (bronze.own_band_max_ghs !== null) {
        expect(Number(bronze.band_max_ghs)).toBe(Number(bronze.own_band_max_ghs))
      } else {
        expect(Number(bronze.band_max_ghs)).toBeGreaterThan(140)
      }
    })
  })
})
