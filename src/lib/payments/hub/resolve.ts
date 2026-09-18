import 'server-only'

import { randomUUID } from 'node:crypto'

import { hubPaymentStatus } from '@/lib/payments/hub/client'
import { type PaymentKind, applyHubEvent, findHubPayment } from '@/lib/payments/hub/fulfil'
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
 *
 * Since 2026-09-18 a reference may name a VAULT deposit rather than a plan.
 * Which it is changes nothing about the settling itself: the hub is asked the
 * same question and `applyHubEvent` grants the right thing. The caller is told
 * anyway, because the page the buyer is looking at has to say Vault or plan and
 * send them back to the right screen.
 */

export type SettleState = 'confirmed' | 'pending' | 'failed' | 'reversed' | 'unknown'

export type SettleResult = {
  state: SettleState
  /** Which product was paid for. Unknown references have no kind to report. */
  kind?: PaymentKind
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

  /* The same lookup fulfilment uses, so a reference resolves to one kind of
     payment here and cannot resolve to the other one a moment later. */
  const found = await findHubPayment(admin, reference)
  if (!found.ok) return { state: 'unknown' }
  const { kind, payment } = found

  /* Already settled: say so without spending a round trip on the hub. This is
     the common case on the return page, because the confirm endpoint usually
     wins the race. */
  if (payment.status !== 'pending') {
    return { state: FROM_ROW[payment.status] ?? 'unknown', kind }
  }

  const status = await hubPaymentStatus(reference)
  if (!status.ok) {
    /* Unreachable is not failed. A payment that really went through must not
       be shown as failed because a network call did not land, so the caller
       is told to keep waiting. */
    return { state: 'pending', kind, unreachable: !status.notFound }
  }

  if (status.status === 'success') {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference,
      amountMinor: status.amountMinor,
      currency: status.currency,
      /* `domain` goes in so this path is guarded exactly as the confirm
         endpoint is. The two race each other by design, and a check that only
         one of them performs is a check a reload can walk around. */
      payload: { via: 'return_page', paid_at: status.paidAt, domain: status.domain },
    })
    if (outcome.ok) return { state: 'confirmed', kind }

    /*
      A mismatch, and test money, are neither a success nor a failure the user
      can fix. Leave it pending on screen: an admin is the next step, not the
      buyer.

      ⚠️ AND WRITE IT DOWN HERE, rather than assuming the confirm endpoint
      already did. That assumption was in the comment this replaces, and it
      holds only when the hub's POST arrived. When it did not, or has not yet,
      this path refused a payment and left NO row anywhere: not on the payment,
      which stays `pending` exactly as an unfinished checkout does, and not in
      `hub_inbound_events`, which is the only screen that shows a refusal. A
      guard nobody can see is worth about as much as no guard.
    */
    if (outcome.reason === 'mismatch' || outcome.reason === 'test_mode') {
      await recordRefusal(reference, outcome.reason, outcome.detail, outcome.paymentId, outcome.kind)
    }
    return { state: 'pending', kind, unreachable: false }
  }

  if (status.status === 'reversed') {
    await applyHubEvent({ event: 'payment.reversed', reference, payload: { via: 'return_page' } })
    return { state: 'reversed', kind }
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
    return { state: 'failed', kind }
  }

  // Still `initialized` at the hub: the user may simply be quicker than the bank.
  return { state: 'pending', kind }
}

/**
 * A refusal this path reached on its own, put where an admin will find it.
 *
 * `request_id` is invented, because there was no hub request: nothing was
 * posted to us, we asked. The column is `not null unique` and exists to stop a
 * delivery being replayed, and a locally raised row has nothing to replay.
 *
 * ONE ROW PER REFERENCE PER VERDICT. The return page polls, and every poll
 * that lands here reaches the same refusal, so writing unconditionally would
 * turn one refused payment into a screenful of identical flags and bury the
 * other ones. A failure to record is swallowed for the same reason the caller
 * returns `pending`: the buyer is looking at this, and a logging problem must
 * not become their error message.
 */
async function recordRefusal(
  reference: string,
  result: 'mismatch' | 'test_mode',
  detail: string,
  paymentId: string,
  kind: PaymentKind,
): Promise<void> {
  try {
    const admin = createAdminClient()

    const { data: already } = await admin
      .from('hub_inbound_events')
      .select('id')
      .eq('hub_reference', reference)
      .eq('result', result)
      .limit(1)
      .maybeSingle()

    if (already) return

    await admin.from('hub_inbound_events').insert({
      request_id: randomUUID(),
      event: 'payment.success',
      hub_reference: reference,
      payment_id: paymentId,
      /* ⚠️ `payment_id` lost its foreign key in migration 232 precisely so a
         vault deposit could be flagged here. The kind is what tells the admin
         screen which table to read the buyer's name from, so a row written
         without it points at the wrong one. */
      payment_kind: kind,
      payload: { via: 'return_page', raised_here: true } as never,
      result,
      detail,
    })
  } catch {
    /* Deliberately silent. See above. */
  }
}
