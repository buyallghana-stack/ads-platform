import 'server-only'

import { checkSuccessAmount, paystackMode, testModeDetail } from '@/lib/payments/hub/decide'
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
 * app holds no key to do it with. What it checks instead is two things, and
 * both live in `decide.ts` where they can be tested without a database:
 *
 *   WHOSE MONEY   `domain` says `live`, or says nothing yet. Test money grants
 *                 nothing, because the store's account was in test mode in
 *                 production and six plans were granted against no money at
 *                 all before anybody thought to ask which Paystack.
 *   HOW MUCH      the figure the hub states is the figure this row asked for.
 *                 A figure it does not state is a refusal, not a pass.
 */

export type HubEvent = 'payment.success' | 'payment.failed' | 'payment.reversed'

export type FulfilOutcome =
  | { ok: true; state: 'confirmed' | 'failed' | 'reversed'; alreadyDone: boolean; paymentId: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'mismatch'; paymentId: string; detail: string }
  | { ok: false; reason: 'test_mode'; paymentId: string; detail: string }
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
 *
 * ⚠️ AN UNSTATED AMOUNT IS A DISAGREEMENT, as of 17 September 2026. It used to
 * be a skipped check: the amount defaulted to the expected one, compared equal
 * to itself, and granted the plan. Both readings are in `decide.ts` now, and
 * neither can be satisfied by an absence.
 */
export async function applyHubEvent(input: {
  event: HubEvent
  reference: string
  /* Whatever the hub said, unjudged. `decide.ts` decides whether it is an
     amount at all, which is the only place that reading exists. */
  amountMinor?: number | string | null
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
    A success is checked twice before anything is granted: WHOSE money, then
    HOW MUCH. A failure or a reversal skips both. They carry the original
    amount for context, and refusing to act on a reversal because a figure
    disagreed would leave a refunded payment holding a live plan, which is the
    wrong way to fail.
  */
  if (input.event === 'payment.success') {
    /*
      TEST MONEY IS NOT MONEY. The store's Paystack account was in test mode in
      production and neither app could see it, so six payments were reported
      successful, signed correctly, and granted plans against nothing. The
      field the hub would have to send is `domain`, and it does not send it
      yet, so `unknown` still passes: see `paystackMode`.

      The switch is `app_config.hub_accept_test_payments`, off by default,
      because the one time this is wanted is a rehearsal and the rest of the
      time it is a free plan.
    */
    if (paystackMode(input.payload) === 'test' && !(await acceptsTestPayments(admin))) {
      return {
        ok: false,
        reason: 'test_mode',
        paymentId: payment.id,
        detail: testModeDetail(input.reference),
      }
    }

    const verdict = checkSuccessAmount({
      expectedMinor: payment.amount_minor,
      expectedCurrency: payment.currency_code,
      statedMinor: input.amountMinor,
      statedCurrency: input.currency,
    })

    if (!verdict.ok) {
      return { ok: false, reason: 'mismatch', paymentId: payment.id, detail: verdict.detail }
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

/**
 * Whether an admin has said test money may grant a plan.
 *
 * Read through the SERVICE client, and read every time rather than cached: the
 * whole value of a switch on the money path is that flipping it takes effect
 * now, and a rehearsal is exactly when somebody flips it and immediately
 * retries.
 *
 * ⚠️ MISSING ROW MEANS NO. `app_config`'s select policy is
 * `is_public or is_admin()`, and this key is private, so a read with the wrong
 * client returns nothing and LOOKS like a clean false. Here that accident and
 * the real answer agree, which is the only reason it is safe: never copy this
 * shape for a key whose absent value should be true.
 */
async function acceptsTestPayments(admin: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const { data } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'hub_accept_test_payments')
    .maybeSingle()

  return data?.value === 'true'
}
