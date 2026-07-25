import { NextResponse } from 'next/server'

import { serverEnv } from '@/lib/env'
import { confirmPaystackReference } from '@/lib/payments/confirm'
import { verifyWebhookSignature } from '@/lib/payments/paystack'

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
  } catch {
    return NextResponse.json({ received: true, ignored: 'unparseable' })
  }

  if (event.event !== 'charge.success' || !event.data?.reference) {
    return NextResponse.json({ received: true, ignored: event.event ?? 'unknown' })
  }

  const outcome = await confirmPaystackReference(event.data.reference)

  return NextResponse.json({
    received: true,
    confirmed: outcome.ok,
    ...(outcome.ok ? { alreadyDone: outcome.alreadyDone } : { reason: outcome.reason }),
  })
}
