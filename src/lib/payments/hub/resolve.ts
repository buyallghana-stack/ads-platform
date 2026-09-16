import 'server-only'

import { hubPaymentStatus } from '@/lib/payments/hub/client'
import { applyHubEvent } from '@/lib/payments/hub/fulfil'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Asking the hub what happened, and acting on the answer.
 *
 * Used by the page the user lands on after paying and by the reconciliation
 * sweep, because they want the same thing: this app has a reference and no
 * confirmation yet, and the hub knows which it is.
 *
 * ⚠️ NEVER TRUST THE REDIRECT. The reference arrives in a URL the user can
 * type. It is used to look up a row and then to ASK the hub, and nothing is
 * granted on the strength of the parameter itself.
 */

export type SettleState = 'confirmed' | 'pending' | 'failed' | 'reversed' | 'unknown'

export type SettleResult = {
  state: SettleState
  /** True when the hub could not be reached, so "pending" means "do not know". */
  unreachable?: boolean
}

const FROM_ROW: Record<string, SettleState> = {
  confirmed: 'confirmed',
  failed: 'failed',
  refunded: 'reversed',
  pending: 'pending',
}

export async function settleFromHub(reference: string): Promise<SettleResult> {
  const admin = createAdminClient()

  const { data } = await admin
    .from('subscription_payments')
    .select('id, status')
    .eq('external_reference', reference)
    .maybeSingle()

  if (!data) return { state: 'unknown' }

  /* Already settled: say so without spending a round trip on the hub. This is
     the common case on the return page, because the confirm endpoint usually
     wins the race. */
  if (data.status !== 'pending') {
    return { state: FROM_ROW[data.status] ?? 'unknown' }
  }

  const status = await hubPaymentStatus(reference)
  if (!status.ok) {
    /* Unreachable is not failed. A payment that really went through must not
       be shown as failed because a network call did not land, so the caller
       is told to keep waiting. */
    return { state: 'pending', unreachable: !status.notFound }
  }

  if (status.status === 'success') {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference,
      amountMinor: status.amountMinor,
      currency: status.currency,
      payload: { via: 'return_page', paid_at: status.paidAt },
    })
    if (outcome.ok) return { state: 'confirmed' }
    /* A mismatch is not a success and not a failure the user can fix. Leave
       it pending on screen: the confirm endpoint has already flagged it, and
       an admin is the next step, not the buyer. */
    return { state: outcome.reason === 'mismatch' ? 'pending' : 'pending', unreachable: false }
  }

  if (status.status === 'reversed') {
    await applyHubEvent({ event: 'payment.reversed', reference, payload: { via: 'return_page' } })
    return { state: 'reversed' }
  }

  /*
    `abandoned` closes a payment exactly as `failed` does, and it is a DEFINITE
    answer rather than a strange one.

    The hub only reaches it by asking Paystack about an attempt that has sat
    unfinished past its own window, so it means "we checked, the money was not
    taken, this attempt is closed", not "we stopped hearing about it". Store
    handover, 16 September 2026. Nothing here treats it as unexpected: doing
    that would leave a buyer watching a spinner over a status the hub is
    entitled to send. The verdict is kept in the payload so the payment row
    records WHICH of the two closed it.
  */
  if (status.status === 'failed' || status.status === 'abandoned') {
    await applyHubEvent({
      event: 'payment.failed',
      reference,
      payload: { via: 'return_page', hub_status: status.status },
    })
    return { state: 'failed' }
  }

  // Still `initialized` at the hub: the user may simply be quicker than the bank.
  return { state: 'pending' }
}
