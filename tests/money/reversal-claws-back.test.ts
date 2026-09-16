import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  PINNED_LADDER,
  type Tx,
  balanceOf,
  createUser,
  pinLadder,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * A reversed payment takes back the plan AND the referral bonus.
 *
 * Operator, 16 September 2026, asked what a refund or chargeback should do:
 * *"on payment reversed it should revoke both referral bonus and plan"*. That
 * is one decision with two halves, and only the first half had a test.
 *
 * ⚠️ WHY THIS FILE EXISTS. The reversal path was verified against the live
 * system the day it shipped, but the account used had no referrer, so the
 * clawback ran against nothing and proved nothing. The commission arm is not
 * theoretical: `referral_purchase_commission_percent` is 10 and its level two
 * is 7, so a referred purchase pays real points to a real person before the
 * chargeback arrives.
 *
 * The two halves belong in one transaction, which is why they live inside
 * `reverse_subscription_payment` rather than in the caller. A plan revoked
 * without the bonus coming back pays a referrer for a sale that was refunded.
 */

const buy = async (tx: Tx, userId: string, slug: string, ghs: number) => {
  const { rows: tier } = await tx.query<{ id: string }>(
    `select id from public.tiers where slug = $1`,
    [slug],
  )
  const { rows } = await tx.query<{ id: string }>(
    `select * from public.start_subscription_payment($1, $2, 'paystack', $3::bigint)`,
    [userId, tier[0]!.id, Math.round(ghs * 100)],
  )
  const paymentId = rows[0]!.id
  await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
    paymentId,
    `TEST-${paymentId}`,
  ])
  return paymentId
}

/**
 * The commission rates this test asserts against, pinned rather than read.
 *
 * ⚠️ WHY. The seeded default for both is 0, and production reads 10 and 7
 * because the operator set them in the admin. Written against production, this
 * file passed by inheriting those numbers, and went red the first time it ran
 * on a database built from the migration history, where a referred purchase
 * pays nothing and there is no commission to claw back.
 *
 * Same rule as `pinLadder`: a money test that reads a live figure is asserting
 * whatever somebody last typed into the admin, and it goes red on a Tuesday
 * for no reason anybody can reconstruct.
 */
const pinCommission = async (tx: Tx) => {
  await setConfig(tx, 'referral_purchase_commission_percent', '10')
  await setConfig(tx, 'referral_purchase_commission_percent_l2', '7')
  await setConfig(tx, 'referral_purchase_commission_cap_points', '0')
  await setConfig(tx, 'referral_purchase_commission_scope', 'new_plans')
}

const commissionsFor = async (tx: Tx, paymentId: string) => {
  const { rows } = await tx.query<{
    level: number
    points: string
    referrer_id: string
    reversed_at: string | null
  }>(
    `select level, points::text, referrer_id, reversed_at
       from public.referral_commissions where payment_id = $1 order by level`,
    [paymentId],
  )
  return rows
}

const livePlans = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ n: string }>(
    `select count(*)::text as n from public.user_subscriptions
      where user_id = $1 and status in ('active', 'grace')`,
    [userId],
  )
  return Number(rows[0]!.n)
}

describe.skipIf(!HAS_DB)('a reversal takes back both halves', () => {
  it('pays a referrer on a referred purchase, then takes it back when the payment reverses', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await pinCommission(tx)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!

      const referrer = await createUser(tx, { name: 'The Referrer' })
      const referee = await createUser(tx, { name: 'The Buyer' })

      const { rows: code } = await tx.query<{ referral_code: string }>(
        `select referral_code from public.profiles where id = $1`,
        [referrer.id],
      )
      await tx.query(`select * from public.apply_referral_code($1, $2, null, $3)`, [
        referee.id,
        code[0]!.referral_code,
        'fingerprint-for-the-buyer',
      ])

      const before = await balanceOf(tx, referrer.id)
      const paymentId = await buy(tx, referee.id, 'bronze', bronze.priceGhs)

      /* The commission arm has to actually fire, or the rest of this test is
         asserting that nothing happened to nothing. */
      const paid = await commissionsFor(tx, paymentId)
      expect(paid.length).toBeGreaterThan(0)
      const owed = paid.reduce((sum, row) => sum + Number(row.points), 0)
      expect(owed).toBeGreaterThan(0)
      expect(paid.every((row) => row.reversed_at === null)).toBe(true)

      const afterPurchase = await balanceOf(tx, referrer.id)
      expect(afterPurchase).toBe(before + owed)
      expect(await livePlans(tx, referee.id)).toBe(1)

      // The chargeback arrives.
      await tx.query(`select * from public.reverse_subscription_payment($1, $2)`, [
        paymentId,
        'Reversed at the provider',
      ])

      const { rows: payment } = await tx.query<{ status: string }>(
        `select status from public.subscription_payments where id = $1`,
        [paymentId],
      )
      expect(payment[0]!.status).toBe('refunded')

      // Half one: the plan.
      expect(await livePlans(tx, referee.id)).toBe(0)

      // Half two: the bonus, both levels, marked as well as debited.
      const reversed = await commissionsFor(tx, paymentId)
      expect(reversed.every((row) => row.reversed_at !== null)).toBe(true)
      expect(await balanceOf(tx, referrer.id)).toBe(before)
    })
  })

  it('does not push a referrer negative when they have already spent it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await pinCommission(tx)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!

      const referrer = await createUser(tx, { name: 'Already Spent It' })
      const referee = await createUser(tx, { name: 'Second Buyer' })
      const { rows: code } = await tx.query<{ referral_code: string }>(
        `select referral_code from public.profiles where id = $1`,
        [referrer.id],
      )
      await tx.query(`select * from public.apply_referral_code($1, $2, null, $3)`, [
        referee.id,
        code[0]!.referral_code,
        'fingerprint-for-the-second-buyer',
      ])

      const paymentId = await buy(tx, referee.id, 'bronze', bronze.priceGhs)
      const owed = (await commissionsFor(tx, paymentId)).reduce(
        (sum, row) => sum + Number(row.points),
        0,
      )
      expect(owed).toBeGreaterThan(0)

      /* Spend the lot, which is what a referrer who withdrew would look like
         by the time a chargeback lands weeks later. */
      await tx.query(
        `select public.debit_points($1, $2::bigint, 'admin_adjustment', 'test', null, '{}'::jsonb)`,
        [referrer.id, owed],
      )
      expect(await balanceOf(tx, referrer.id)).toBe(0)

      await tx.query(`select * from public.reverse_subscription_payment($1, $2)`, [
        paymentId,
        'Reversed at the provider',
      ])

      /* ⚠️ THE BALANCE MUST NOT GO NEGATIVE. `claw_back_referral_points` takes
         what is there and returns what it recovered. Inventing a debt against
         somebody who was paid in good faith is a decision for a human, so the
         shortfall is recorded as an alert instead. */
      expect(await balanceOf(tx, referrer.id)).toBe(0)

      const { rows: alerts } = await tx.query<{ code: string }>(
        `select code from public.system_alerts
          where code = 'referral_clawback_short'
            and context->>'payment_id' = $1`,
        [paymentId],
      )
      expect(alerts.length).toBe(1)

      // And the commission is still marked reversed, whatever was recovered.
      expect((await commissionsFor(tx, paymentId)).every((r) => r.reversed_at !== null)).toBe(true)
    })
  })
})
