import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  PINNED_LADDER,
  type Tx,
  createUser,
  expectRejection,
  pinLadder,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * Coupon codes on the ads side.
 *
 * Operator, 2026-08-11. The rule that shapes everything else: a coupon names
 * the tier it applies to, so it can never move somebody between bands. It
 * reduces the money the business receives and leaves the plan alone.
 *
 * That is why the assertions below check TWO numbers on every purchase: what
 * was charged, and what the plan is worth afterwards. A test that only checked
 * the charge would pass just as happily if a coupon quietly demoted somebody
 * from Platinum to Gold, which is the failure this design exists to prevent.
 *
 * THE LADDER IS PINNED, for the reason spelled out in `flexible-pricing`: the
 * operator retunes prices in the admin, and a coupon test that inherits live
 * prices is a test that goes red on a Tuesday for no reason.
 */

const superAdmin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

const tierId = async (tx: Tx, slug: string) => {
  const { rows } = await tx.query<{ id: string }>(`select id from public.tiers where slug = $1`, [
    slug,
  ])
  return rows[0]!.id
}

let seq = 0

/** Creates a coupon through the admin function, so its guards are in the path. */
const makeCoupon = async (
  tx: Tx,
  by: string,
  o: {
    code?: string
    tier?: string
    productId?: string
    kind?: 'percent' | 'fixed'
    percent?: number | null
    amountMinor?: number | null
    capMinor?: number | null
    minSpendMinor?: number
    quota?: number
    perUser?: number
    firstOnly?: boolean
    startsAt?: string | null
    endsAt?: string | null
    active?: boolean
  } = {},
) => {
  seq += 1
  const {
    code = `TEST${Date.now().toString(36).toUpperCase()}${seq}`,
    tier = 'platinum',
    productId = null,
    kind = 'percent',
    percent = 50,
    amountMinor = null,
    capMinor = null,
    minSpendMinor = 0,
    quota = 100,
    perUser = 1,
    firstOnly = true,
    startsAt = null,
    endsAt = null,
    active = true,
  } = o

  const business = productId ? 'affiliate' : 'ads'
  await tx.query(
    `select public.admin_save_coupon(
       $1, null, $2, $3::public.coupon_business, $4, $5,
       $6::public.coupon_discount_kind, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'test')`,
    [
      by,
      code,
      business,
      productId ? null : await tierId(tx, tier),
      productId,
      kind,
      percent,
      amountMinor,
      capMinor,
      minSpendMinor,
      quota,
      perUser,
      firstOnly,
      startsAt,
      endsAt,
      active,
    ],
  )
  return code
}

/** Buys a plan at a chosen amount, optionally with a code, the way checkout does. */
const buy = async (tx: Tx, userId: string, slug: string, ghs: number, code?: string) => {
  const id = await tierId(tx, slug)
  const { rows } = await tx.query<{ id: string; amount_minor: string; list_minor: string | null }>(
    `select id, amount_minor::text, list_minor::text
       from public.start_subscription_payment($1, $2, 'paystack', $3::bigint, $4)`,
    [userId, id, Math.round(ghs * 100), code ?? null],
  )
  const payment = rows[0]!
  await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
    payment.id,
    `COUPON-${payment.id}`,
  ])
  return {
    id: payment.id,
    chargedMinor: Number(payment.amount_minor),
    listMinor: payment.list_minor === null ? null : Number(payment.list_minor),
  }
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

const quote = async (tx: Tx, userId: string, code: string, slug: string, ghs: number) => {
  const { rows } = await tx.query<{
    ok: boolean
    reason: string | null
    discount_minor: string
    charged_minor: string
  }>(
    `select ok, reason, discount_minor::text, charged_minor::text
       from public.coupon_quote($1, $2, $3, null, $4::bigint)`,
    [userId, code, await tierId(tx, slug), Math.round(ghs * 100)],
  )
  const r = rows[0]!
  return {
    ok: r.ok,
    reason: r.reason,
    discountMinor: Number(r.discount_minor),
    chargedMinor: Number(r.charged_minor),
  }
}

const platinum = PINNED_LADDER.find((r) => r.slug === 'platinum')!

describe.skipIf(!HAS_DB)('a coupon reduces the price, not the plan', () => {
  it('charges less and still hands over the whole plan', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Half Price' })
      const code = await makeCoupon(tx, by, { percent: 50 })

      /* GHS 700 chosen inside Platinum's band, half off. */
      const payment = await buy(tx, user.id, 'platinum', 700, code)
      expect([payment.chargedMinor, payment.listMinor]).toEqual([35_000, 70_000])

      /* The point of the whole design: the rate follows the SEVEN HUNDRED they
         chose, not the three hundred and fifty they paid. A coupon names its
         tier, so it cannot move anybody down a band. */
      const standing = await resolved(tx, user.id)
      expect(standing.name).toBe('Platinum')
      expect(standing.dailyAdCap).toBe(platinum.dailyAdCap)
      expect(standing.multiplier).toBeGreaterThan(platinum.multiplier)
    })
  })

  it('leaves the payment alone when no code is used', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'Full Price' })

      const payment = await buy(tx, user.id, 'platinum', 700)
      /* `list_minor` stays null rather than repeating the amount. A list price
         equal to the charge is noise in every report that reads this table. */
      expect([payment.chargedMinor, payment.listMinor]).toEqual([70_000, null])
    })
  })

  it('caps what a percentage can take off', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Capped' })
      const code = await makeCoupon(tx, by, { percent: 50, capMinor: 20_000 })

      /* Half of GHS 700 is GHS 350, but the cap is GHS 200. Without a cap
         every coupon holder buys at the top of the band, because that is
         where the discount is worth most. */
      const q = await quote(tx, user.id, code, 'platinum', 700)
      expect([q.discountMinor, q.chargedMinor]).toEqual([20_000, 50_000])
    })
  })

  it('never charges less than a cedi, whatever the code says', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Almost Free' })
      const code = await makeCoupon(tx, by, {
        tier: 'bronze',
        kind: 'fixed',
        percent: null,
        amountMinor: 999_999,
      })

      /* Paystack cannot charge zero, and a checkout that reaches it fails
         after the buyer has been told the price. Clamped, not refused. */
      const q = await quote(tx, user.id, code, 'bronze', 65)
      expect(q.chargedMinor).toBe(100)
    })
  })
})

describe.skipIf(!HAS_DB)('where a coupon may not be used', () => {
  it('refuses a code that names another plan', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Wrong Plan' })
      const code = await makeCoupon(tx, by, { tier: 'platinum' })

      const q = await quote(tx, user.id, code, 'gold', 250)
      expect([q.ok, q.reason]).toEqual([false, 'wrong_target'])

      /* And the till refuses it too, not only the preview. */
      const message = await expectRejection(tx, () => buy(tx, user.id, 'gold', 250, code))
      expect(message).toMatch(/not for this purchase/i)
    })
  })

  it('cannot be created without naming a plan at all', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      /* The operator's rule: a code which is not designated to a tier cannot
         be used. Enforced so it cannot even be written down. */
      const message = await expectRejection(tx, () =>
        tx.query(
          `select public.admin_save_coupon($1, null, 'NOWHERE', 'ads', null, null,
             'percent', 10, null, null, 0, 10, 1, true, null, null, true, null)`,
          [by],
        ),
      )
      expect(message).toMatch(/name the plan/i)
    })
  })

  it('lets one person use a code once', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Twice' })
      const code = await makeCoupon(tx, by, { tier: 'gold', firstOnly: false, quota: 50 })

      await buy(tx, user.id, 'gold', 250, code)
      const q = await quote(tx, user.id, code, 'gold', 250)
      expect([q.ok, q.reason]).toEqual([false, 'already_used'])
    })
  })

  it('stops at the quota, counting everybody', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const first = await createUser(tx, { name: 'First' })
      const second = await createUser(tx, { name: 'Second' })
      const code = await makeCoupon(tx, by, { tier: 'silver', quota: 1 })

      await buy(tx, first.id, 'silver', 140, code)
      const q = await quote(tx, second.id, code, 'silver', 140)
      expect([q.ok, q.reason]).toEqual([false, 'exhausted'])
    })
  })

  it('gives a place back when a checkout is abandoned', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const gone = await createUser(tx, { name: 'Walked Away' })
      const next = await createUser(tx, { name: 'Next In Line' })
      const code = await makeCoupon(tx, by, { tier: 'silver', quota: 1 })

      /* Started and never confirmed, which is exactly what an abandoned
         Paystack page leaves behind, and this platform has real ones. */
      await tx.query(
        `select public.start_subscription_payment($1, $2, 'paystack', $3::bigint, $4)`,
        [gone.id, await tierId(tx, 'silver'), 14_000, code],
      )
      expect((await quote(tx, next.id, code, 'silver', 140)).reason).toBe('exhausted')

      /* The hold is a window, not a lock: no cron, no release path, nothing to
         drift. Winding the clock forward is the same as waiting an hour. */
      await tx.query(
        `update public.coupon_redemptions set created_at = now() - interval '2 hours'`,
      )
      expect((await quote(tx, next.id, code, 'silver', 140)).ok).toBe(true)
    })
  })

  it('refuses a code outside its window', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Too Late' })

      const finished = await makeCoupon(tx, by, {
        tier: 'gold',
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      })
      expect((await quote(tx, user.id, finished, 'gold', 250)).reason).toBe('expired')

      const early = await makeCoupon(tx, by, {
        tier: 'gold',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      expect((await quote(tx, user.id, early, 'gold', 250)).reason).toBe('not_started')
    })
  })

  it('refuses a purchase below the minimum spend', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Too Small' })
      const code = await makeCoupon(tx, by, { tier: 'platinum', minSpendMinor: 80_000 })

      expect((await quote(tx, user.id, code, 'platinum', 600)).reason).toBe('min_spend')
      expect((await quote(tx, user.id, code, 'platinum', 900)).ok).toBe(true)
    })
  })

  it('keeps a first purchase code away from a renewal', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Renewing' })
      const code = await makeCoupon(tx, by, { tier: 'bronze', firstOnly: true, perUser: 5, quota: 9 })

      await buy(tx, user.id, 'bronze', 65)
      /* They hold Bronze now, so buying it again is a renewal however the
         checkout describes it. The switch is per coupon, defaulting on, so a
         win-back campaign is still possible with it off. */
      expect((await quote(tx, user.id, code, 'bronze', 65)).reason).toBe('first_purchase_only')
    })
  })

  it('stops working when it is switched off', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Paused' })
      const code = await makeCoupon(tx, by, { tier: 'gold', active: false })

      expect((await quote(tx, user.id, code, 'gold', 250)).reason).toBe('inactive')
    })
  })

  it('does not care how the code was typed', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Shouty' })
      const code = await makeCoupon(tx, by, { tier: 'gold' })

      /* Case does not survive a WhatsApp broadcast or a phone keyboard. */
      expect((await quote(tx, user.id, code.toLowerCase(), 'gold', 250)).ok).toBe(true)
      expect((await quote(tx, user.id, ` ${code} `, 'gold', 250)).ok).toBe(true)
    })
  })
})

describe.skipIf(!HAS_DB)('what the admin can see', () => {
  it('counts a confirmed use and what it cost', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Counted' })
      const code = await makeCoupon(tx, by, { tier: 'gold', percent: 20 })

      await buy(tx, user.id, 'gold', 250, code)

      const { rows } = await tx.query<{
        used: number
        quota: number
        discount_given_minor: string
        revenue_minor: string
      }>(
        `select used, quota, discount_given_minor::text, revenue_minor::text
           from public.admin_list_coupons($1) where code = $2`,
        [by, code],
      )
      /* GHS 250 at 20% off: GHS 50 given away, GHS 200 taken. The operator
         asked how many are used; the answer is worth nothing without the two
         money columns beside it. */
      expect([
        rows[0]!.used,
        Number(rows[0]!.discount_given_minor),
        Number(rows[0]!.revenue_minor),
      ]).toEqual([1, 5_000, 20_000])
    })
  })

  it('will not delete a code somebody has used', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Used It' })
      const code = await makeCoupon(tx, by, { tier: 'gold' })
      await buy(tx, user.id, 'gold', 250, code)

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.coupons where code = $1`,
        [code],
      )
      /* The redemptions are a money record and the delete would cascade
         through them. Switching it off keeps both. */
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_delete_coupon($1, $2)`, [by, rows[0]!.id]),
      )
      expect(message).toMatch(/switched off but not deleted/i)
    })
  })

  it('honours the hold window as a setting', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'coupon_hold_minutes', '0')
      const by = await superAdmin(tx)
      const gone = await createUser(tx, { name: 'Instant Release' })
      const next = await createUser(tx, { name: 'Straight In' })
      const code = await makeCoupon(tx, by, { tier: 'silver', quota: 1 })

      await tx.query(
        `select public.start_subscription_payment($1, $2, 'paystack', $3::bigint, $4)`,
        [gone.id, await tierId(tx, 'silver'), 14_000, code],
      )
      /* Zero minutes means an unconfirmed checkout holds nothing at all. */
      expect((await quote(tx, next.id, code, 'silver', 140)).ok).toBe(true)
    })
  })
})
