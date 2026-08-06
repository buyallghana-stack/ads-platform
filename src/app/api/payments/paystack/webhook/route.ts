import { NextResponse } from 'next/server'

import { serverEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { confirmPaystackReference } from '@/lib/payments/confirm'
import { verifyWebhookSignature } from '@/lib/payments/paystack'
import { confirmProductOrder } from '@/lib/market/orders'

/**
 * Paystack webhook.
 *
 * This is the path that MATTERS. The browser callback can be lost — a dead
 * battery, a closed tab, a dropped connection on the way back from the bank —
 * and the user would have paid for nothing. Paystack calls this regardless,
 * and retries if we fail, so the plan is granted either way.
 *
 * Two rules for a payment webhook, both observed here:
 *   1. Verify the signature before believing a word of it. Anyone can POST to
 *      a public URL claiming a payment succeeded.
 *   2. Never trust the body's "amount". confirmPaystackReference re-asks
 *      Paystack what actually happened and checks it against our own row.
 *
 * Always answers 200 once the signature checks out, even if we could not act
 * on it — a non-200 makes Paystack retry, and retrying will not fix a payment
 * that genuinely failed. Anything unusual is left in the payment row.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!serverEnv().PAYSTACK_SECRET_KEY) {
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
  }

  // Must be the RAW body: re-serialising JSON changes the bytes and the
  // signature would never match.
  const raw = await request.text()

  if (!verifyWebhookSignature(raw, request.headers.get('x-paystack-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { event?: string; data?: { reference?: string } }
  try {
    event = JSON.parse(raw)
  } catch (error) {
    /*
      The signature already verified, so this body came from Paystack and we
      still could not read it. That is not a caller mistake, it is a contract
      change or a corruption, and it means a real payment may go unconfirmed.
    */
    reportUnexpected(error, 'paystack.webhook.parse')
    return NextResponse.json({ received: true, ignored: 'unparseable' })
  }

  if (event.event !== 'charge.success' || !event.data?.reference) {
    return NextResponse.json({ received: true, ignored: event.event ?? 'unknown' })
  }

  /*
    ONE WEBHOOK, TWO KINDS OF PURCHASE.

    Paystack posts to a single configured URL, so this route has to serve both
    businesses: a plan (`subscription_payments`) and a shop order (`orders`).
    The reference is the row id in one table or the other, and they cannot
    collide — both are uuids from different tables.

    Try the plan first because it is the older and busier path, and fall
    through on `not_found` only. Any other failure is a real failure of THAT
    path and must not be retried as the other one: a mismatched amount on a
    subscription is not an order, it is a problem.
  */
  let outcome: { ok: true; alreadyDone: boolean } | { ok: false; reason: string } =
    await confirmPaystackReference(event.data.reference)

  if (!outcome.ok && outcome.reason === 'not_found') {
    /* No cookie on a webhook, so no visitor token. Attribution still works
       through the account-side binding: a click made while signed in is
       recorded against the user as well as the browser. */
    outcome = await confirmProductOrder(event.data.reference, null)
  }

  /*
    MONEY ARRIVED AND WE DID NOT GRANT IT. Paystack has taken the customer's
    money and told us so; if confirmation failed the person has paid for a
    plan they do not have, and nothing else in the system will notice.
    Reported with the reference so it can be reconciled by hand.
  */
  if (!outcome.ok) {
    reportUnexpected(new Error(`Paystack confirmation failed: ${outcome.reason}`), 'paystack.webhook.confirm', {
      reference: event.data.reference,
      reason: outcome.reason,
    })
  }

  return NextResponse.json({
    received: true,
    confirmed: outcome.ok,
    ...(outcome.ok ? { alreadyDone: outcome.alreadyDone } : { reason: outcome.reason }),
  })
}
