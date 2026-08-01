import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  balanceOf,
  createUser,
  creditPoints,
  expectRejection,
  givePayoutDetails,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * Three operator decisions of 2026-08-01, each of which changes what somebody
 * is paid — so each is proved here rather than reasoned about.
 *
 *   free_earning_days          a free account earns for 21 days, then stops
 *   redemption_minimum_points  one withdrawal minimum for every account
 *   redemption_fee_percent     a percentage off the top, frozen per request
 *
 * WHAT THESE ARE REALLY GUARDING. The free window is the only defence on this
 * platform that caps what farming can be WORTH rather than how hard it is, so
 * the tests below are written as the ways round it: hold a plan, wait a day,
 * be paid by somebody else's referral, claim something earned earlier. And the
 * fee is money that never reaches the person it was quoted to, which is
 * exactly the kind of arithmetic that must not drift — so it is checked
 * against the stored row, not against the code that wrote it.
 */

/** Somebody who joined `days` ago. The window counts from the profile. */
const joinedDaysAgo = async (tx: Tx, days: number, name = 'Free User') => {
  const user = await createUser(tx, { name, joinedDaysAgo: days })
  await tx.query(`update public.profiles set created_at = now() - make_interval(days => $2::int) where id = $1`, [
    user.id,
    days,
  ])
  return user
}

/** A live plan on this account, which is what lifts the window. */
const givePlan = async (tx: Tx, userId: string, slug = 'bronze') => {
  await tx.query(
    `insert into public.user_subscriptions (user_id, tier_id, status, started_at, current_period_end)
     select $1, t.id, 'active', now(), now() + interval '30 days'
       from public.tiers t where t.slug = $2`,
    [userId, slug],
  )
}

const request = async (tx: Tx, userId: string, points: number) => {
  const { rows } = await tx.query(
    `select * from public.request_redemption($1, 'mobile_money', $2::bigint)`,
    [userId, points],
  )
  return rows[0]!
}

const redemptionRow = async (tx: Tx, id: string) => {
  const { rows } = await tx.query(`select * from public.redemptions where id = $1`, [id])
  return rows[0]!
}

describe.skipIf(!HAS_DB)('the free earning window', () => {
  it('lets a new free account earn', async () => {
    await withRollback(async (tx) => {
      const user = await joinedDaysAgo(tx, 3)
      await creditPoints(tx, user.id, 100)
      expect(await balanceOf(tx, user.id)).toBe(100)
    })
  })

  it('stops a free account once the window has passed', async () => {
    await withRollback(async (tx) => {
      const user = await joinedDaysAgo(tx, 22)
      const message = await expectRejection(tx, () => creditPoints(tx, user.id, 100))
      expect(message).toMatch(/free plan earns for 21 days/i)
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('lifts it the moment they hold a plan', async () => {
    await withRollback(async (tx) => {
      const user = await joinedDaysAgo(tx, 400)
      await expectRejection(tx, () => creditPoints(tx, user.id, 100))

      await givePlan(tx, user.id)
      await creditPoints(tx, user.id, 100)
      expect(await balanceOf(tx, user.id)).toBe(100)
    })
  })

  it('is a platform setting, not a number in the code', async () => {
    await withRollback(async (tx) => {
      const user = await joinedDaysAgo(tx, 30)
      await expectRejection(tx, () => creditPoints(tx, user.id, 100))

      await setConfig(tx, 'free_earning_days', '60')
      await creditPoints(tx, user.id, 100)
      expect(await balanceOf(tx, user.id)).toBe(100)
    })
  })

  it('can be switched off entirely with 0', async () => {
    await withRollback(async (tx) => {
      const user = await joinedDaysAgo(tx, 900)
      await setConfig(tx, 'free_earning_days', '0')
      await creditPoints(tx, user.id, 100)
      expect(await balanceOf(tx, user.id)).toBe(100)
    })
  })

  it('never blocks a refund, an adjustment or a gift code', async () => {
    await withRollback(async (tx) => {
      const user = await joinedDaysAgo(tx, 100)

      /* These three are not earning. A refund returns points the platform
         took and did not pay out — refusing it would be keeping somebody's
         money — and the other two are an operator acting deliberately. */
      for (const entry of ['redemption_refund', 'admin_adjustment', 'gift_code']) {
        await tx.query(`select public.credit_points($1, 50, $2::public.ledger_entry_type)`, [
          user.id,
          entry,
        ])
      }
      expect(await balanceOf(tx, user.id)).toBe(150)
    })
  })

  it('stops every kind of earning, not only ads', async () => {
    await withRollback(async (tx) => {
      const user = await joinedDaysAgo(tx, 22)
      for (const entry of ['ad_view', 'survey', 'task_reward', 'game_prize', 'referral_signup']) {
        const message = await expectRejection(tx, () =>
          tx.query(`select public.credit_points($1, 10, $2::public.ledger_entry_type)`, [user.id, entry]),
        )
        expect(message).toMatch(/free plan earns/i)
      }
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('leaves points already earned withdrawable after it closes', async () => {
    await withRollback(async (tx) => {
      const user = await joinedDaysAgo(tx, 10)
      await creditPoints(tx, user.id, 6000)
      await givePayoutDetails(tx, user.id)

      // The window closes while they are holding the points.
      await tx.query(`update public.profiles set created_at = now() - interval '40 days' where id = $1`, [
        user.id,
      ])
      await expectRejection(tx, () => creditPoints(tx, user.id, 1))

      const result = await request(tx, user.id, 6000)
      expect(result.status).toBe('held')
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('one withdrawal minimum for everybody', () => {
  it('refuses less than the platform minimum', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Small Ask' })
      await creditPoints(tx, user.id, 10_000)
      await givePayoutDetails(tx, user.id)

      await setConfig(tx, 'redemption_minimum_points', '5000')
      const message = await expectRejection(tx, () => request(tx, user.id, 4999))
      expect(message).toMatch(/smallest withdrawal is 5000 points/i)
      expect(await balanceOf(tx, user.id)).toBe(10_000)
    })
  })

  it('applies the same number to a plan holder as to a free account', async () => {
    await withRollback(async (tx) => {
      const free = await createUser(tx, { name: 'Free' })
      const paid = await createUser(tx, { name: 'Platinum' })
      await givePlan(tx, paid.id, 'platinum')

      await setConfig(tx, 'redemption_minimum_points', '5000')

      for (const user of [free, paid]) {
        await creditPoints(tx, user.id, 10_000)
        await givePayoutDetails(tx, user.id, { msisdn: user === free ? '0244000111' : '0244000222' })
        const message = await expectRejection(tx, () => request(tx, user.id, 4000))
        expect(message).toMatch(/smallest withdrawal is 5000 points/i)
      }

      /* And the SCREENS agree with the refusal: resolve_user_tier is what
         every one of them reads, and it used to answer from the plan's own
         column — which still holds 1,000 for Platinum. */
      const { rows } = await tx.query(
        `select (public.resolve_user_tier($1)).redemption_minimum_points as free_min,
                (public.resolve_user_tier($2)).redemption_minimum_points as paid_min`,
        [free.id, paid.id],
      )
      expect(Number(rows[0]!.free_min)).toBe(5000)
      expect(Number(rows[0]!.paid_min)).toBe(5000)
    })
  })

  it('follows the setting when the operator changes it', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Mover' })
      await creditPoints(tx, user.id, 10_000)
      await givePayoutDetails(tx, user.id)

      await setConfig(tx, 'redemption_minimum_points', '2000')
      const result = await request(tx, user.id, 2000)
      expect(result.status).toBe('held')
    })
  })
})

describe.skipIf(!HAS_DB)('the withdrawal fee', () => {
  it('takes nothing while the rate is zero', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'No Fee' })
      await creditPoints(tx, user.id, 10_000)
      await givePayoutDetails(tx, user.id)
      await setConfig(tx, 'redemption_fee_percent', '0')

      const result = await request(tx, user.id, 10_000)
      const row = await redemptionRow(tx, result.redemption_id ?? result.id)
      expect(Number(row.fee_percent)).toBe(0)
      expect(Number(row.fee_amount)).toBe(0)
      expect(Number(row.net_amount)).toBe(Number(row.currency_amount))
    })
  })

  it('takes the percentage off the money and freezes what it took', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Fee Payer' })
      await creditPoints(tx, user.id, 10_000)
      await givePayoutDetails(tx, user.id)
      await setConfig(tx, 'points_per_currency_unit', '1000')
      await setConfig(tx, 'redemption_fee_percent', '2.5')

      const result = await request(tx, user.id, 10_000)
      const row = await redemptionRow(tx, result.redemption_id ?? result.id)

      // 10,000 points at 1,000/GHS = GHS 10.00, less 2.5% = GHS 9.75.
      expect(Number(row.currency_amount)).toBe(10)
      expect(Number(row.fee_percent)).toBe(2.5)
      expect(Number(row.fee_amount)).toBe(0.25)
      expect(Number(row.net_amount)).toBe(9.75)

      // The POINTS are untouched by the fee: the user redeemed what they
      // asked for, and the cut comes off the cedis on the way out.
      expect(Number(row.points_amount)).toBe(10_000)
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('does not rewrite a request that was already quoted', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Quoted Early' })
      await creditPoints(tx, user.id, 20_000)
      await givePayoutDetails(tx, user.id)
      await setConfig(tx, 'redemption_fee_percent', '1')

      const first = await request(tx, user.id, 10_000)

      // The operator raises the fee afterwards.
      await setConfig(tx, 'redemption_fee_percent', '20')

      const before = await redemptionRow(tx, first.redemption_id ?? first.id)
      expect(Number(before.fee_percent)).toBe(1)

      // And the next request carries the new rate, not the old one.
      const second = await request(tx, user.id, 10_000)
      const after = await redemptionRow(tx, second.redemption_id ?? second.id)
      expect(Number(after.fee_percent)).toBe(20)
    })
  })

  it('refuses a fee that would take the whole payout', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'All Fee' })
      await creditPoints(tx, user.id, 10_000)
      await givePayoutDetails(tx, user.id)
      await setConfig(tx, 'redemption_fee_percent', '100')

      const message = await expectRejection(tx, () => request(tx, user.id, 10_000))
      expect(message).toMatch(/fee would take the whole payout/i)
      expect(await balanceOf(tx, user.id)).toBe(10_000)
    })
  })

  it('gives the whole amount back when a request is refunded', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Refunded' })
      await creditPoints(tx, user.id, 10_000)
      await givePayoutDetails(tx, user.id)
      await setConfig(tx, 'redemption_fee_percent', '10')

      const result = await request(tx, user.id, 10_000)
      expect(await balanceOf(tx, user.id)).toBe(0)

      const admin = await createUser(tx, { name: 'Admin' })
      await tx.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [admin.id])
      await tx.query(`select public.reject_redemption($1, $2, 'testing the refund')`, [
        admin.id,
        result.redemption_id ?? result.id,
      ])

      /* The fee is only ever realised on money that actually left. A declined
         request took none, so the user gets every point back — not the points
         less a fee for a transfer that never happened. */
      expect(await balanceOf(tx, user.id)).toBe(10_000)
    })
  })
})
