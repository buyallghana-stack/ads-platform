import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  PINNED_LADDER,
  type Tx,
  createUser,
  expectRejection,
  pinLadder,
  withRollback,
} from '../support/db'

/**
 * A payment can arrive after we gave up on it.
 *
 * ⚠️ WHAT THIS PROTECTS. Three things close a payment here without Paystack
 * ever being consulted: the reconciliation sweep at 48 hours, and the hub
 * answering `failed` or `abandoned`. None of them is proof that no money moved.
 * Until migration 230 `confirm_subscription_payment` raised on any closed
 * payment, so a genuine `payment.success` arriving afterwards made
 * `/api/internal/hub/confirm` answer 500, the hub retried for 24 hours, gave
 * up, and a buyer who had paid held no plan. Nothing raised anywhere a person
 * would see it: on our side the row read `failed`, which is exactly what it
 * would read if the buyer really had walked away.
 *
 * It stopped being theoretical on 16 September 2026, when the Tech Store
 * shipped a sweep that asks Paystack about stale intents and settles the ones
 * that were paid, forwarding the notification as it goes. A late success is
 * now a thing that endpoint is built to send.
 *
 * The line between the two halves of this file is evidence. `failed` means we
 * concluded nothing was paid, and a later payment overrules a conclusion.
 * `refunded` means money moved and came back, which no event may quietly undo.
 */

const startPayment = async (tx: Tx, userId: string, slug: string, ghs: number) => {
  const { rows: tier } = await tx.query<{ id: string }>(
    `select id from public.tiers where slug = $1`,
    [slug],
  )
  const { rows } = await tx.query<{ id: string }>(
    `select * from public.start_subscription_payment($1, $2, 'paystack', $3::bigint)`,
    [userId, tier[0]!.id, Math.round(ghs * 100)],
  )
  return rows[0]!.id
}

const paymentRow = async (tx: Tx, paymentId: string) => {
  const { rows } = await tx.query<{ status: string; failure_reason: string | null }>(
    `select status, failure_reason from public.subscription_payments where id = $1`,
    [paymentId],
  )
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

describe.skipIf(!HAS_DB)('a payment confirmed after it was closed', () => {
  it('grants the plan when a success arrives for a payment we had failed', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!
      const buyer = await createUser(tx, { name: 'The Late Buyer' })

      const paymentId = await startPayment(tx, buyer.id, 'bronze', bronze.priceGhs)

      // Two days pass and the sweep closes it, with Paystack never asked.
      await tx.query(`select * from public.fail_subscription_payment($1, $2)`, [
        paymentId,
        'The payment did not complete',
      ])
      expect((await paymentRow(tx, paymentId)).status).toBe('failed')
      expect(await livePlans(tx, buyer.id)).toBe(0)

      // The hub's own sweep asks Paystack, finds the money, and tells us.
      await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
        paymentId,
        `TEST-LATE-${paymentId}`,
      ])

      const after = await paymentRow(tx, paymentId)
      expect(after.status).toBe('confirmed')
      /* A confirmed row must not still carry the sentence explaining why it
         failed, or every screen that reads this column tells an admin a plan
         that is live did not complete. */
      expect(after.failure_reason).toBeNull()
      expect(await livePlans(tx, buyer.id)).toBe(1)
    })
  })

  it('leaves an alert behind, because a buyer was told the wrong thing', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!
      const buyer = await createUser(tx, { name: 'The Late Buyer' })

      const paymentId = await startPayment(tx, buyer.id, 'bronze', bronze.priceGhs)
      await tx.query(`select * from public.fail_subscription_payment($1, $2)`, [
        paymentId,
        'The payment did not complete',
      ])
      await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
        paymentId,
        `TEST-LATE-${paymentId}`,
      ])

      const { rows } = await tx.query<{ code: string; context: Record<string, unknown> }>(
        `select code, context from public.system_alerts
          where code = 'late_payment_confirmed'
            and context->>'payment_id' = $1`,
        [paymentId],
      )

      /* Silence would be the wrong outcome even though the money is now right.
         Somebody was shown a failure and is holding a plan they were told they
         did not get, and support needs to find that out from a screen rather
         than from the buyer. */
      expect(rows).toHaveLength(1)
      expect(rows[0]!.context.was_failed_because).toBe('The payment did not complete')
    })
  })

  it('still refuses to confirm a payment that was refunded', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!
      const buyer = await createUser(tx, { name: 'The Refunded Buyer' })

      const paymentId = await startPayment(tx, buyer.id, 'bronze', bronze.priceGhs)
      await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
        paymentId,
        `TEST-${paymentId}`,
      ])
      await tx.query(`select * from public.reverse_subscription_payment($1, $2)`, [
        paymentId,
        'Reversed at the provider',
      ])
      expect((await paymentRow(tx, paymentId)).status).toBe('refunded')

      /* ⚠️ THE OTHER DIRECTION OF THE SAME CHANGE. Money that was given back
         must not become a live plan again because a late event turned up
         behind the refund. */
      const refusal = await expectRejection(tx, () =>
        tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
          paymentId,
          `TEST-LATE-${paymentId}`,
        ]),
      )
      expect(refusal).toMatch(/cannot be confirmed/i)
      expect((await paymentRow(tx, paymentId)).status).toBe('refunded')
    })
  })

  it('is still a no-op for a payment already confirmed', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!
      const buyer = await createUser(tx, { name: 'The Twice Told Buyer' })

      const paymentId = await startPayment(tx, buyer.id, 'bronze', bronze.priceGhs)
      await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
        paymentId,
        `TEST-${paymentId}`,
      ])
      await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
        paymentId,
        `TEST-${paymentId}`,
      ])

      // One plan, not two periods and not two rows.
      expect(await livePlans(tx, buyer.id)).toBe(1)
    })
  })
})
