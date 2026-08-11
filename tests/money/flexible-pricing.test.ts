import { describe, expect, it } from 'vitest'

import { multiplierForAmount, pointsPerAd } from '../../src/lib/subscriptions/pricing'
import type { Plan } from '../../src/lib/subscriptions/data'
import {
  HAS_DB,
  type LadderRung,
  PINNED_LADDER,
  type Tx,
  createUser,
  expectRejection,
  pinLadder,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * Plans as price BANDS: what you pay inside one decides what an ad is worth.
 *
 * Operator, 2026-08-04: *"we may be in the same bronze plan but my points per
 * ad may be worth a few points more than my fellow bronze plan holder because
 * of the amount i paid from within the range."*
 *
 * THE LADDER IS PINNED, AND THAT IS THE POINT. This file used to assert the
 * prices that were on sale on the day bands shipped, on the reasoning that a
 * published figure is a promise somebody will screenshot. The operator then did
 * what the admin screen exists to let them do — moved Bronze to ×1.39, Silver
 * to ×1.84, Platinum to ×4.12 and deleted Diamond, all in eight minutes on
 * 2026-08-05 — and seven tests went red without a line of code changing.
 *
 * What is being tested here is not a price list. It is the SHAPE of a ladder:
 * that a rung pays exactly its own multiplier, that the rate climbs smoothly
 * across a band, that there is no step to jump at a boundary, that the top
 * clamps rather than selling nothing, and that stacking cannot beat paying the
 * same money once. None of that is a fact about GHS 65, so every test below
 * runs against `PINNED_LADDER` and none of them can be broken by a price
 * change again.
 *
 * THE ARITHMETIC EXISTS TWICE, which is the real risk in this feature.
 * Postgres decides what an ad actually pays; TypeScript decides what the
 * slider promises while somebody drags it, because a round trip per pixel is
 * not an option on a Ghanaian connection. Two implementations of one rule
 * drift, and the drift would be a screen quoting a number the database will
 * not honour — so the last test sweeps the whole ladder and compares them
 * pesewa by pesewa. THAT ONE READS THE LIVE TABLES ON PURPOSE: pinning it
 * would prove the two agree about a ladder nobody can buy.
 */

/* Derived from the pinned rungs rather than typed out beside them — two lists
   of the same numbers is exactly how a fixture starts lying about itself. The
   peg is 100 points to the cedi, which `pinLadder` also holds. */
const PUBLISHED = PINNED_LADDER.map((rung) => ({
  ghs: rung.priceGhs,
  band: rung.name,
  multiplier: rung.multiplier,
  pointsPerAd: Math.floor(100 * rung.multiplier),
}))

/** The rung above a given one, for a boundary the fixture must not hardcode. */
const rungAbove = (ghs: number) => PINNED_LADDER.find((r) => r.priceGhs > ghs) ?? null

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
      await pinLadder(tx)
      for (const rung of PUBLISHED) {
        expect([rung.ghs, await multiplierAt(tx, rung.ghs)]).toEqual([rung.ghs, rung.multiplier])
        expect([rung.ghs, await bandAt(tx, rung.ghs)]).toEqual([rung.ghs, rung.band])
      }
    })
  })

  it('turns those multipliers into the advertised points and cedis', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
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
      await pinLadder(tx)
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
      await pinLadder(tx)
      /* The top of one band and the floor of the next must almost touch. A gap
         either way is money somebody can find: a jump up rewards paying one
         cedi more than the band allows, a jump down punishes it.

         Every boundary the ladder actually has, walked rather than listed —
         a hardcoded pair outlives the rung it belongs to, and the version of
         this test that named GHS 1000 kept comparing the top plan against
         ITSELF once Diamond was deleted, then failed on `4.12 > 4.12` and
         looked like a broken interpolation. */
      for (const rung of PINNED_LADDER) {
        const next = rungAbove(rung.priceGhs)
        if (!next) continue
        const below = await multiplierAt(tx, next.priceGhs - 1)
        const above = await multiplierAt(tx, next.priceGhs)
        expect([next.slug, above > below]).toEqual([next.slug, true])
        expect([next.slug, above - below < 0.02]).toEqual([next.slug, true])
      }
    })
  })

  it('stops at the top of the ladder rather than selling nothing', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      expect(await multiplierAt(tx, 1000)).toBe(3.5)
      expect(await multiplierAt(tx, 5000)).toBe(3.5)

      // And the checkout refuses to take the money in the first place.
      const user = await createUser(tx, { name: 'Over Payer' })
      const message = await expectRejection(tx, () => buy(tx, user.id, 'diamond', 1500))
      expect(message).toMatch(/most you can pay/i)
    })
  })
})

describe.skipIf(!HAS_DB)('the top plan, when it carries its own ceiling', () => {
  /**
   * Operator, 2026-08-05: *"make the platinum plan a range of GHS 520–GHS 1000,
   * that's why i deleted the diamond plan."*
   *
   * Deleting the rung above did not hand its price to the plan below — it left
   * that plan at the top of the ladder, sold at one figure. So the top rung
   * carries the two numbers the deleted rung used to supply: where its line
   * ends, and what is earned there.
   *
   * The pinned ladder here is the real one, cut short: Platinum on top, at the
   * prices and rates the operator actually set.
   */
  const CAPPED: LadderRung[] = [
    { slug: 'free', name: 'Free', priceGhs: 0, multiplier: 1.0, dailyAdCap: 1 },
    { slug: 'bronze', name: 'Bronze', priceGhs: 65, multiplier: 1.39, dailyAdCap: 3 },
    { slug: 'silver', name: 'Silver', priceGhs: 140, multiplier: 1.84, dailyAdCap: 4 },
    { slug: 'gold', name: 'Gold', priceGhs: 250, multiplier: 2.5, dailyAdCap: 7 },
    {
      slug: 'platinum',
      name: 'Platinum',
      priceGhs: 520,
      multiplier: 4.12,
      dailyAdCap: 13,
      bandMaxGhs: 1000,
      bandMaxMultiplier: 7.0,
    },
  ]

  it('sells the top plan as a range rather than one price', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx, { rungs: CAPPED })
      const { rows } = await tx.query<{ max: string }>(
        `select public.plan_band_max_minor(id)::text as max from public.tiers where slug = 'platinum'`,
      )
      expect(Number(rows[0]!.max)).toBe(100000)
    })
  })

  it('reaches the advertised rate exactly at the top of the band', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx, { rungs: CAPPED })
      /* EXACTLY ×7, not a hair under. Between two rungs a band stops one
         pesewa short so the next one can take over without a step; the top
         rung has nothing to hand off to, so the last pesewa is ours to pay. */
      expect(await multiplierAt(tx, 1000)).toBe(7)
      expect(await multiplierAt(tx, 520)).toBe(4.12)
      expect(await multiplierAt(tx, 760)).toBe(5.56) // halfway, on the line
    })
  })

  it('stops at the ceiling instead of extrapolating past it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx, { rungs: CAPPED })
      /* The failure this guards is not a rounding error. Below the top rung an
         over-payment lands on the NEXT rung, so nothing ever ran past the end
         of a line; at the top there is no next rung to catch it, and an
         unclamped line would pay ×31 for GHS 5,000. */
      expect(await multiplierAt(tx, 1001)).toBe(7)
      expect(await multiplierAt(tx, 5000)).toBe(7)
      expect(await multiplierAt(tx, 100000)).toBe(7)
    })
  })

  it('refuses money above the ceiling at the checkout, too', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx, { rungs: CAPPED })
      const user = await createUser(tx, { name: 'Over The Top' })
      const message = await expectRejection(tx, () => buy(tx, user.id, 'platinum', 1200))
      expect(message).toMatch(/most you can pay/i)

      // …and takes the ceiling itself, which is the point of the range.
      await buy(tx, user.id, 'platinum', 1000)
      expect((await resolved(tx, user.id)).multiplier).toBe(7)
    })
  })

  it('is not trimmed by the runaway-configuration ceiling', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx, { rungs: CAPPED })
      /* THE BUG THIS FEATURE UNCOVERED. `resolve_user_tier` ends with
         `least(multiplier, subscription_max_combined_multiplier)`, and that key
         sat at 3.500 while Platinum's own rate was already ×4.120 — so every
         Platinum holder was being paid ×3.5 and the plan screen promised
         ×4.12. A safety net that trims real customers is not a safety net. */
      const { rows } = await tx.query<{ v: string }>(
        `select value as v from public.app_config
          where key = 'subscription_max_combined_multiplier'`,
      )
      const ceiling = Number(rows[0]!.v)
      const topOfLadder = CAPPED[CAPPED.length - 1]!.bandMaxMultiplier!
      expect([ceiling > topOfLadder, ceiling]).toEqual([true, ceiling])

      const user = await createUser(tx, { name: 'Top Payer' })
      await buy(tx, user.id, 'platinum', 1000)
      expect((await resolved(tx, user.id)).multiplier).toBe(7)
    })
  })
})

describe.skipIf(!HAS_DB)('buying at your own amount', () => {
  it('gives a Bronze holder who paid more a better rate than one who paid the floor', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
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
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'Underpayer' })
      const message = await expectRejection(tx, () => buy(tx, user.id, 'silver', 100))
      expect(message).toMatch(/least you can pay/i)
    })
  })

  it('refuses an amount that belongs to the plan above', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'Sneaky' })
      /* GHS 200 buys Silver's rate, not Bronze's — paying it under Bronze's
         name would be buying the higher rate at the lower plan's ad cap. */
      const message = await expectRejection(tx, () => buy(tx, user.id, 'bronze', 200))
      expect(message).toMatch(/most you can pay/i)
    })
  })

  it('adds up what somebody holds, so stacking cannot beat paying the same total', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
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
      await pinLadder(tx)
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
      await pinLadder(tx)
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
      /* DELIBERATELY NOT PINNED — the only test in this file that is not.
         Every other one asks whether the rule is right; this one asks whether
         the screen and the database say the same thing about the prices REALLY
         ON SALE, and a fixture ladder would prove they agree about a ladder
         nobody can buy. It is the one that must survive the operator retuning. */
      const { rows } = await tx.query(
        `select id, slug, name, price_minor, reward_multiplier, sort_order,
                band_max_minor, band_max_multiplier,
                lead(price_minor)       over (order by sort_order) as next_price,
                lead(reward_multiplier) over (order by sort_order) as next_multiplier
           from public.tiers where is_active order by sort_order`,
      )

      /* Built the way `getPlans` builds it, including the top rung's own
         ceiling — otherwise this proves the screen agrees with the database
         about a Platinum that stops at GHS 520, which is not the one on
         sale. */
      const plans = rows
        .filter((r) => Number(r.price_minor) > 0)
        .map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          rewardMultiplier: Number(r.reward_multiplier),
          bandMinMinor: Number(r.price_minor),
          bandMaxMinor:
            r.next_price === null
              ? Number(r.band_max_minor ?? r.price_minor)
              : Number(r.next_price) - 1,
          nextMultiplier:
            r.next_multiplier === null
              ? Number(r.band_max_multiplier ?? r.reward_multiplier)
              : Number(r.next_multiplier),
          lineEndMinor:
            r.next_price === null
              ? Number(r.band_max_minor ?? r.price_minor)
              : Number(r.next_price),
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

/**
 * Migration 177. The operator, 2026-08-11: manager holds all four plans and
 * can still only watch 13 ads a day, "which is contrary to what was promised".
 *
 * Migration 036 built the adding-up rule; migration 098 replaced the whole
 * function with the band and took the rule with it, leaving three pieces of
 * live copy promising something the database had stopped doing. The rate was
 * never the problem and is not what these test.
 */
describe.skipIf(!HAS_DB)('the daily limit when plans stack', () => {
  /* The four purchasable rungs at their floor prices, which is the cheapest
     way to hold everything and therefore the case that shows the rule most
     plainly. Derived from the pinned ladder, never typed out beside it. */
  const paid = PINNED_LADDER.filter((r) => r.priceGhs > 0 && r.slug !== 'diamond')
  const free = PINNED_LADDER.find((r) => r.priceGhs === 0)!
  const buyEverything = async (tx: Tx, userId: string) => {
    for (const rung of paid) await buy(tx, userId, rung.slug, rung.priceGhs)
  }

  it('counts the free allowance once and adds what each plan gives above it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'All Four' })
      await buyEverything(tx, user.id)

      const expected =
        free.dailyAdCap + paid.reduce((sum, r) => sum + Math.max(r.dailyAdCap - free.dailyAdCap, 0), 0)

      /* 1 + 2 + 3 + 6 + 12 = 24 on the pinned ladder. The free allowance is
         added once rather than four times, or holding four plans would hand
         out the free tier three extra times. */
      expect((await resolved(tx, user.id)).dailyAdCap).toBe(expected)
    })
  })

  it('leaves somebody holding one plan exactly where they were', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'Just Platinum' })
      const platinum = PINNED_LADDER.find((r) => r.slug === 'platinum')!
      await buy(tx, user.id, 'platinum', platinum.priceGhs)

      expect((await resolved(tx, user.id)).dailyAdCap).toBe(platinum.dailyAdCap)
    })
  })

  it('never hands out less than the total spend already bought', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'Deep In Two Bands' })

      /* Bronze and Silver bought at the TOP of their bands: GHS 139 + 249 =
         388, which lands in Gold. Gold's cap is 7, the two plans add up to 6,
         and the answer has to be 7 — a rule that could cut somebody's ads for
         paying more would be worse than the bug it replaced. */
      await buy(tx, user.id, 'bronze', 139)
      await buy(tx, user.id, 'silver', 249)

      const standing = await resolved(tx, user.id)
      expect(standing.name).toBe('Gold')
      expect(standing.dailyAdCap).toBe(PINNED_LADDER.find((r) => r.slug === 'gold')!.dailyAdCap)
    })
  })

  it('goes back to the band alone when the operator asks for it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'ad_cap_combine_mode', 'band')
      const user = await createUser(tx, { name: 'Band Only' })
      await buyEverything(tx, user.id)

      /* Exactly what shipped between 2026-08-04 and 2026-08-11, kept as a
         setting rather than deleted, because the operator chose neither. */
      expect((await resolved(tx, user.id)).dailyAdCap).toBe(
        PINNED_LADDER.find((r) => r.slug === 'platinum')!.dailyAdCap,
      )
    })
  })

  it('drops to the single best plan when stacking is switched off', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'subscription_stacking_enabled', 'false')
      const user = await createUser(tx, { name: 'No Stacking' })
      await buyEverything(tx, user.id)

      const platinum = PINNED_LADDER.find((r) => r.slug === 'platinum')!
      const standing = await resolved(tx, user.id)

      /* The switch was read by nothing at all between 2026-08-04 and this
         migration: the admin could turn stacking off and every stacked user
         kept every benefit. Off now means the best plan they hold, at the
         amount paid for that one, so the rate is Platinum's own. */
      expect(standing.dailyAdCap).toBe(platinum.dailyAdCap)
      expect(standing.multiplier).toBe(platinum.multiplier)
    })
  })
})
