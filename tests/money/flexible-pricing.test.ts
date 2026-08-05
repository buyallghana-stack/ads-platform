import { describe, expect, it } from 'vitest'

import { multiplierForAmount, pointsPerAd } from '../../src/lib/subscriptions/pricing'
import type { Plan } from '../../src/lib/subscriptions/data'
import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Plans as price BANDS: what you pay inside one decides what an ad is worth.
 *
 * Operator, 2026-08-04: *"we may be in the same bronze plan but my points per
 * ad may be worth a few points more than my fellow bronze plan holder because
 * of the amount i paid from within the range."*
 *
 * THE PUBLISHED NUMBERS ARE THE CONTRACT. Every price in the operator's list
 * has a figure printed beside it, and those figures are what somebody will
 * screenshot and hold us to — so each one is asserted exactly rather than
 * approximately, and a change to the interpolation that moves any of them
 * fails here.
 *
 * THE ARITHMETIC EXISTS TWICE, which is the real risk in this feature.
 * Postgres decides what an ad actually pays; TypeScript decides what the
 * slider promises while somebody drags it, because a round trip per pixel is
 * not an option on a Ghanaian connection. Two implementations of one rule
 * drift, and the drift would be a screen quoting a number the database will
 * not honour — so the last test sweeps the whole ladder and compares them
 * pesewa by pesewa.
 */

const PUBLISHED: { ghs: number; band: string; multiplier: number; pointsPerAd: number }[] = [
  { ghs: 0, band: 'Free', multiplier: 1.0, pointsPerAd: 100 },
  { ghs: 65, band: 'Bronze', multiplier: 1.5, pointsPerAd: 150 },
  { ghs: 140, band: 'Silver', multiplier: 2.0, pointsPerAd: 200 },
  { ghs: 250, band: 'Gold', multiplier: 2.5, pointsPerAd: 250 },
  { ghs: 520, band: 'Platinum', multiplier: 3.0, pointsPerAd: 300 },
  { ghs: 1000, band: 'Diamond', multiplier: 3.5, pointsPerAd: 350 },
]

const multiplierAt = async (tx: Tx, ghs: number) => {
  const { rows } = await tx.query<{ m: string }>(
    `select public.plan_multiplier_for_amount($1::bigint) as m`,
    [Math.round(ghs * 100)],
  )
  return Number(rows[0]!.m)
}

const bandAt = async (tx: Tx, ghs: number) => {
  const { rows } = await tx.query<{ name: string }>(
    `select (public.plan_band_for_amount($1::bigint)).name as name`,
    [Math.round(ghs * 100)],
  )
  return rows[0]!.name
}

const tierId = async (tx: Tx, slug: string) => {
  const { rows } = await tx.query<{ id: string }>(`select id from public.tiers where slug = $1`, [slug])
  return rows[0]!.id
}

/** Buy a plan at a chosen amount, the way the checkout does. */
const buy = async (tx: Tx, userId: string, slug: string, ghs: number) => {
  const id = await tierId(tx, slug)
  const { rows } = await tx.query<{ id: string }>(
    `select * from public.start_subscription_payment($1, $2, 'paystack', $3::bigint)`,
    [userId, id, Math.round(ghs * 100)],
  )
  /* A unique reference per purchase: `subscription_payments_ref_idx` enforces
     that one provider reference confirms one payment, which is what makes a
     replayed Paystack webhook harmless. Reusing a literal here fails on the
     second purchase in a test, not in the product. */
  await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
    rows[0]!.id,
    `TEST-${rows[0]!.id}`,
  ])
  return rows[0]!.id
}

const resolved = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ name: string; m: string; cap: number }>(
    `select (public.resolve_user_tier($1)).name as name,
            (public.resolve_user_tier($1)).reward_multiplier as m,
            (public.resolve_user_tier($1)).daily_ad_cap as cap`,
    [userId],
  )
  return { name: rows[0]!.name, multiplier: Number(rows[0]!.m), dailyAdCap: rows[0]!.cap }
}

describe.skipIf(!HAS_DB)('the published ladder', () => {
  it('pays exactly what the pricing list promises at every plan price', async () => {
    await withRollback(async (tx) => {
      for (const rung of PUBLISHED) {
        expect([rung.ghs, await multiplierAt(tx, rung.ghs)]).toEqual([rung.ghs, rung.multiplier])
        expect([rung.ghs, await bandAt(tx, rung.ghs)]).toEqual([rung.ghs, rung.band])
      }
    })
  })

  it('turns those multipliers into the advertised points and cedis', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query<{ v: string }>(
        `select value as v from public.app_config where key = 'points_per_currency_unit'`,
      )
      const perCedi = Number(rows[0]!.v)

      for (const rung of PUBLISHED) {
        const points = Math.floor(100 * (await multiplierAt(tx, rung.ghs)))
        expect([rung.ghs, points]).toEqual([rung.ghs, rung.pointsPerAd])
        // …and what those points are worth, which is the number on the card.
        expect([rung.ghs, points / perCedi]).toEqual([rung.ghs, rung.pointsPerAd / 100])
      }
    })
  })

  it('moves between the rungs, so two Bronze holders can differ', async () => {
    await withRollback(async (tx) => {
      const floor = await multiplierAt(tx, 65)
      const middle = await multiplierAt(tx, 99)
      const top = await multiplierAt(tx, 139)

      expect(floor).toBe(1.5)
      expect(middle).toBeGreaterThan(floor)
      expect(top).toBeGreaterThan(middle)
      // The operator's example: GHS 99 on Bronze.
      expect(middle).toBe(1.727)
      expect(Math.floor(100 * middle)).toBe(172)
    })
  })

  it('has no step to jump at a band boundary', async () => {
    await withRollback(async (tx) => {
      /* The top of one band and the floor of the next must almost touch. A gap
         either way is money somebody can find: a jump up rewards paying one
         cedi more than the band allows, a jump down punishes it. */
      for (const [top, next] of [
        [139, 140],
        [249, 250],
        [519, 520],
        [999, 1000],
      ]) {
        const below = await multiplierAt(tx, top)
        const above = await multiplierAt(tx, next)
        expect(above).toBeGreaterThan(below)
        expect(above - below).toBeLessThan(0.02)
      }
    })
  })

  it('stops at the top of the ladder rather than selling nothing', async () => {
    await withRollback(async (tx) => {
      expect(await multiplierAt(tx, 1000)).toBe(3.5)
      expect(await multiplierAt(tx, 5000)).toBe(3.5)

      // And the checkout refuses to take the money in the first place.
      const user = await createUser(tx, { name: 'Over Payer' })
      const message = await expectRejection(tx, () => buy(tx, user.id, 'diamond', 1500))
      expect(message).toMatch(/most you can pay/i)
    })
  })
})

describe.skipIf(!HAS_DB)('buying at your own amount', () => {
  it('gives a Bronze holder who paid more a better rate than one who paid the floor', async () => {
    await withRollback(async (tx) => {
      const thrifty = await createUser(tx, { name: 'Paid The Floor' })
      const generous = await createUser(tx, { name: 'Paid More' })

      await buy(tx, thrifty.id, 'bronze', 65)
      await buy(tx, generous.id, 'bronze', 130)

      const a = await resolved(tx, thrifty.id)
      const b = await resolved(tx, generous.id)

      // Same plan, same daily allowance…
      expect(a.name).toBe('Bronze')
      expect(b.name).toBe('Bronze')
      expect(a.dailyAdCap).toBe(b.dailyAdCap)

      // …and a different rate, which is the whole point of the feature.
      expect(b.multiplier).toBeGreaterThan(a.multiplier)
      expect(a.multiplier).toBe(1.5)
      expect(b.multiplier).toBe(1.933)
    })
  })

  it('refuses an amount below the plan it claims to be buying', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Underpayer' })
      const message = await expectRejection(tx, () => buy(tx, user.id, 'silver', 100))
      expect(message).toMatch(/least you can pay/i)
    })
  })

  it('refuses an amount that belongs to the plan above', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Sneaky' })
      /* GHS 200 buys Silver's rate, not Bronze's — paying it under Bronze's
         name would be buying the higher rate at the lower plan's ad cap. */
      const message = await expectRejection(tx, () => buy(tx, user.id, 'bronze', 200))
      expect(message).toMatch(/most you can pay/i)
    })
  })

  it('adds up what somebody holds, so stacking cannot beat paying the same total', async () => {
    await withRollback(async (tx) => {
      const stacker = await createUser(tx, { name: 'Two Plans' })
      const single = await createUser(tx, { name: 'One Payment' })

      await buy(tx, stacker.id, 'bronze', 65)
      await buy(tx, stacker.id, 'silver', 140)
      await buy(tx, single.id, 'gold', 250)

      // 65 + 140 = 205, which sits inside Silver; one payment of 205 would too.
      const both = await resolved(tx, stacker.id)
      expect(both.name).toBe('Silver')

      const alone = await resolved(tx, single.id)
      expect(alone.name).toBe('Gold')
      expect(alone.multiplier).toBeGreaterThan(both.multiplier)
    })
  })

  it('treats a renewal as the new amount, not as more money on top', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Renewer' })
      await buy(tx, user.id, 'bronze', 65)
      expect((await resolved(tx, user.id)).multiplier).toBe(1.5)

      await buy(tx, user.id, 'bronze', 130)
      const after = await resolved(tx, user.id)

      /* Still Bronze at GHS 130 — not GHS 195. Renewing the same plan buys
         another period at whatever it now costs; it does not stack with
         itself, or somebody could climb the ladder by renewing repeatedly. */
      expect(after.name).toBe('Bronze')
      expect(after.multiplier).toBe(1.933)
    })
  })

  it('leaves somebody who has paid nothing on Free', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Free Rider' })
      const standing = await resolved(tx, user.id)
      expect(standing.name).toBe('Free')
      expect(standing.multiplier).toBe(1)
      expect(standing.dailyAdCap).toBe(1)
    })
  })
})

describe.skipIf(!HAS_DB)('the slider and the database agree', () => {
  it('quotes the same rate the database will pay, at every cedi on the ladder', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query(
        `select id, slug, name, price_minor, reward_multiplier, sort_order,
                lead(price_minor)       over (order by sort_order) as next_price,
                lead(reward_multiplier) over (order by sort_order) as next_multiplier
           from public.tiers where is_active order by sort_order`,
      )

      const plans = rows
        .filter((r) => Number(r.price_minor) > 0)
        .map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          rewardMultiplier: Number(r.reward_multiplier),
          bandMinMinor: Number(r.price_minor),
          bandMaxMinor:
            r.next_price === null ? Number(r.price_minor) : Number(r.next_price) - 1,
          nextMultiplier:
            r.next_multiplier === null ? Number(r.reward_multiplier) : Number(r.next_multiplier),
        })) as unknown as Plan[]

      /* Every amount in ONE query rather than one query per amount: a round
         trip per cedi is a thousand of them against a remote database, which
         is a test that times out rather than a test that fails. */
      const amounts: { plan: Plan; minor: number }[] = []
      for (const plan of plans) {
        for (let minor = plan.bandMinMinor; minor <= plan.bandMaxMinor; minor += 100) {
          amounts.push({ plan, minor })
        }
      }

      const { rows: fromDatabase } = await tx.query<{ minor: string; m: string }>(
        `select a.minor::text as minor, public.plan_multiplier_for_amount(a.minor) as m
           from unnest($1::bigint[]) as a(minor)`,
        [amounts.map((a) => a.minor)],
      )
      const dbByAmount = new Map(fromDatabase.map((r) => [Number(r.minor), Number(r.m)]))

      let checked = 0
      for (const { plan, minor } of amounts) {
        const screen = pointsPerAd(100, multiplierForAmount(plan, minor))
        const database = pointsPerAd(100, dbByAmount.get(minor)!)
        /* Compared at the precision that actually reaches a user — the points
           an ad pays — because the database rounds the multiplier to three
           decimals and the screen has no reason to. */
        expect([plan.slug, minor, screen]).toEqual([plan.slug, minor, database])
        checked += 1
      }

      // A sweep that silently checked nothing would pass just as loudly.
      expect(checked).toBeGreaterThan(100)
    })
  })
})
