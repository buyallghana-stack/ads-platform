import { describe, expect, it } from 'vitest'

import { HAS_DB, PINNED_LADDER, type Tx, createUser, pinLadder, withRollback } from '../support/db'

/**
 * Manual mobile money (migration 20260906000000): the SAME money path as a
 * Paystack payment, only confirmed by a person. These call the functions the
 * way `startManualCheckout` and the admin's Confirm and Reject buttons do.
 */

const startManual = async (tx: Tx, userId: string, ghs: number) => {
  const { rows: tier } = await tx.query<{ id: string }>(`select id from public.tiers where slug = 'bronze'`)
  const { rows } = await tx.query<{ id: string; method: string; amount_minor: string }>(
    `select * from public.start_subscription_payment($1, $2, 'manual', $3::bigint)`,
    [userId, tier[0]!.id, Math.round(ghs * 100)],
  )
  await tx.query(`update public.subscription_payments set manual_reference = $2 where id = $1`, [
    rows[0]!.id,
    `P-T${rows[0]!.id.slice(0, 5).toUpperCase()}`,
  ])
  return rows[0]!
}

const livePlans = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ n: string }>(
    `select count(*)::text as n from public.user_subscriptions
      where user_id = $1 and status in ('active', 'grace')`,
    [userId],
  )
  return Number(rows[0]!.n)
}

describe.skipIf(!HAS_DB)('a manual mobile money payment', () => {
  it('opens in the plan band like any other, and a confirm grants the plan', () =>
    withRollback(async (tx) => {
      await pinLadder(tx)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!
      const buyer = await createUser(tx, { name: 'Manual Buyer' })

      const payment = await startManual(tx, buyer.id, bronze.priceGhs)
      expect(payment.method).toBe('manual')
      expect(Number(payment.amount_minor)).toBe(Math.round(bronze.priceGhs * 100))
      expect(await livePlans(tx, buyer.id)).toBe(0)

      await tx.query(`select * from public.confirm_subscription_payment($1, $2, $3)`, [
        payment.id,
        'P-TEST',
        { manual: true },
      ])
      expect(await livePlans(tx, buyer.id)).toBe(1)
    }))

  it('refuses a price outside the band, exactly as Paystack does', () =>
    withRollback(async (tx) => {
      await pinLadder(tx)
      const buyer = await createUser(tx, { name: 'Cheap Buyer' })
      await expect(startManual(tx, buyer.id, 1)).rejects.toThrow(/least you can pay/i)
    }))

  it('grants nothing when rejected', () =>
    withRollback(async (tx) => {
      await pinLadder(tx)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!
      const buyer = await createUser(tx, { name: 'Rejected Buyer' })
      const payment = await startManual(tx, buyer.id, bronze.priceGhs)
      await tx.query(`select * from public.fail_subscription_payment($1, $2)`, [payment.id, 'Rejected'])
      expect(await livePlans(tx, buyer.id)).toBe(0)
    }))
})
