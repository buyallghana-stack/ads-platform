import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * What a hub event does to this app's money.
 *
 * ONE function, called from three places: the confirm endpoint the hub posts
 * to, the return page the user lands on, and the reconciliation sweep. They
 * race each other by design, which is fine and is the whole reason this is one
 * function rather than three: `confirm_subscription_payment` is idempotent by
 * payment id, so whoever arrives first grants the plan and the others are a
 * no-op.
 *
 * It does NOT verify anything with Paystack. That is the hub's job and this
 * app holds no key to do it with. What it does check is that the money the hub
 * describes is the money this row asked for.
 */

export type HubEvent = 'payment.success' | 'payment.failed' | 'payment.reversed'

export type FulfilOutcome =
  | { ok: true; state: 'confirmed' | 'failed' | 'reversed'; alreadyDone: boolean; paymentId: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'mismatch'; paymentId: string; detail: string }
  | { ok: false; reason: 'error'; message: string; paymentId?: string }

type PaymentRow = {
  id: string
  status: string
  amount_minor: number | string
  currency_code: string
}

/**
 * Applies one hub event to the payment carrying that reference.
 *
 * `amountMinor` and `currency` are what the hub says was paid. They are
 * compared against the row rather than trusted, because a plan is granted on
 * the strength of this call. On a disagreement nothing is granted and the
 * caller is expected to flag it: the hub is told 2xx anyway, since retrying a
 * mismatch for 24 hours cannot turn it into a match.
 */
export async function applyHubEvent(input: {
  event: HubEvent
  reference: string
  amountMinor?: number | null
  currency?: string | null
  payload?: unknown
}): Promise<FulfilOutcome> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('subscription_payments')
    .select('id, status, amount_minor, currency_code')
    .eq('external_reference', input.reference)
    .maybeSingle()

  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data) return { ok: false, reason: 'not_found' }
  const payment = data as PaymentRow

  /*
    The amount is only checked when the hub states one, and only for a success.
    A failure or a reversal carries the original amount for context; refusing
    to act on a reversal because a figure disagreed would leave a refunded
    payment holding a live plan, which is the wrong way to fail.
  */
  if (input.event === 'payment.success') {
    const expected = Number(payment.amount_minor)
    const paid = Number(input.amountMinor ?? expected)
    const wantCurrency = payment.currency_code.trim().toUpperCase()
    const gotCurrency = (input.currency ?? wantCurrency).trim().toUpperCase()

    if (paid !== expected || gotCurrency !== wantCurrency) {
      /* ⚠️ MAJOR UNITS IN THE SENTENCE, MINOR UNITS IN THE COMPARISON.
         Everything on this path is integer pesewas, and the first version of
         this message printed them raw: "Expected 23000 GHS, the hub reported
         100 GHS" for a GHS 230.00 plan charged GHS 1.00. Out by a factor of a
         hundred, on the one line an admin reads to decide whether a payment is
         wrong. Caught by looking at the admin screen rather than by a test. */
      const inCedis = (minor: number) => (minor / 100).toFixed(2)
      return {
        ok: false,
        reason: 'mismatch',
        paymentId: payment.id,
        detail:
          `Expected ${wantCurrency} ${inCedis(expected)}, ` +
          `the hub reported ${gotCurrency} ${inCedis(paid)}`,
      }
    }
  }

  if (input.event === 'payment.success') {
    if (payment.status === 'confirmed') {
      return { ok: true, state: 'confirmed', alreadyDone: true, paymentId: payment.id }
    }
    const { error: rpcError } = await admin.rpc('confirm_subscription_payment', {
      p_payment_id: payment.id,
      p_reference: input.reference,
      p_payload: (input.payload ?? {}) as never,
    })
    if (rpcError) {
      return { ok: false, reason: 'error', message: rpcError.message, paymentId: payment.id }
    }
    return { ok: true, state: 'confirmed', alreadyDone: false, paymentId: payment.id }
  }

  if (input.event === 'payment.failed') {
    if (payment.status !== 'pending') {
      return {
        ok: true,
        state: payment.status === 'refunded' ? 'reversed' : 'failed',
        alreadyDone: true,
        paymentId: payment.id,
      }
    }
    const { error: rpcError } = await admin.rpc('fail_subscription_payment', {
      p_payment_id: payment.id,
      p_reason: 'The payment did not complete',
    })
    if (rpcError) {
      return { ok: false, reason: 'error', message: rpcError.message, paymentId: payment.id }
    }
    return { ok: true, state: 'failed', alreadyDone: false, paymentId: payment.id }
  }

  /*
    Reversal. Operator, 16 September 2026: revoke the plan AND claw back the
    referral bonus. Both live inside reverse_subscription_payment so they
    happen in one transaction: a plan revoked without the bonus coming back
    would pay a referrer for a sale that was refunded.
  */
  if (payment.status === 'refunded') {
    return { ok: true, state: 'reversed', alreadyDone: true, paymentId: payment.id }
  }
  const { error: rpcError } = await admin.rpc('reverse_subscription_payment', {
    p_payment_id: payment.id,
    p_reason: 'The payment was reversed at the provider',
  })
  if (rpcError) {
    return { ok: false, reason: 'error', message: rpcError.message, paymentId: payment.id }
  }
  return { ok: true, state: 'reversed', alreadyDone: false, paymentId: payment.id }
}
