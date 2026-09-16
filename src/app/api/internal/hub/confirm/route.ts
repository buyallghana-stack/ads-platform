import { NextResponse } from 'next/server'

import { hubSecrets } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { type HubEvent, applyHubEvent } from '@/lib/payments/hub/fulfil'
import {
  HUB_REQUEST_ID_HEADER,
  HUB_SIGNATURE_HEADER,
  HUB_TIMESTAMP_HEADER,
  verifyHubRequest,
} from '@/lib/payments/hub/sign'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The Tech Store hub telling us what Paystack said.
 *
 * This is the path that MATTERS, for the same reason the old Paystack webhook
 * did: the user's browser may never come back from the bank, and the hub calls
 * this regardless and retries for 24 hours until it gets a 2xx.
 *
 * ⚠️ 2xx MEANS STOP, AND IT IS NOT THE SAME AS "IT WORKED". A mismatch we have
 * decided not to act on still answers 2xx, because retrying it for a day
 * cannot turn a wrong amount into a right one; it is flagged for an admin
 * instead. Only a fault on OUR side, something a later attempt could get past,
 * answers non-2xx.
 *
 * Anyone on the internet can post here. The signature is the only thing
 * standing between a stranger and a free Platinum plan, so it is checked
 * before the body is even parsed.
 */
export const dynamic = 'force-dynamic'

const EVENTS: HubEvent[] = ['payment.success', 'payment.failed', 'payment.reversed']

type Body = {
  event?: string
  reference?: string
  external_ref?: string
  amount_minor?: number
  currency?: string
  paid_at?: string
}

export async function POST(request: Request) {
  const secrets = hubSecrets('inbound')
  if (secrets.length === 0) {
    /* Not configured is not the same as forged. 503 tells the hub to come
       back, which is what we want while a deploy is missing its secret. */
    return NextResponse.json({ error: 'The payment hub is not configured here' }, { status: 503 })
  }

  // The RAW body. Re-serialising JSON changes the bytes and the signature
  // would never match.
  const raw = await request.text()

  const verified = verifyHubRequest({
    secrets,
    timestamp: request.headers.get(HUB_TIMESTAMP_HEADER),
    requestId: request.headers.get(HUB_REQUEST_ID_HEADER),
    signature: request.headers.get(HUB_SIGNATURE_HEADER),
    body: raw,
  })
  if (!verified.ok) {
    return NextResponse.json({ error: 'Invalid signature', reason: verified.reason }, { status: 401 })
  }

  let body: Body
  try {
    body = JSON.parse(raw) as Body
  } catch {
    return NextResponse.json({ error: 'Body is not JSON' }, { status: 400 })
  }

  const event = body.event as HubEvent | undefined
  if (!event || !EVENTS.includes(event)) {
    return NextResponse.json({ error: 'Unknown event' }, { status: 400 })
  }
  if (!body.reference) {
    return NextResponse.json({ error: 'An event needs a reference' }, { status: 400 })
  }

  const admin = createAdminClient()

  /*
    REPLAY PROTECTION, AND THE ORDER MATTERS.

    The row goes in FIRST, on a unique request id. A second delivery of the
    same request id loses the insert and returns here without touching the
    money. The hub promises never to send an event twice, so this is the
    second belt rather than the first, and it is worth having because the
    promise is theirs to keep and the money is ours to lose.

    Burning the id on a failure is safe: every retry from the hub is a NEW
    signed request with a new id, so a refusal here never blocks the retry
    that fixes it.
  */
  const { error: seen } = await admin.from('hub_inbound_events').insert({
    request_id: verified.requestId,
    event,
    hub_reference: body.reference,
    amount_minor: body.amount_minor ?? null,
    currency_code: body.currency ?? null,
    payload: body as never,
    result: 'received',
  })

  if (seen) {
    // 23505: unique violation, meaning we have already handled this exact request.
    if (seen.code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    reportUnexpected(seen, 'hub.confirm', { step: 'record', reference: body.reference })
    return NextResponse.json({ error: 'Could not record the event' }, { status: 500 })
  }

  const finish = async (result: string, detail?: string, paymentId?: string) => {
    await admin
      .from('hub_inbound_events')
      .update({ result, detail: detail ?? null, payment_id: paymentId ?? null })
      .eq('request_id', verified.requestId)
  }

  try {
    const outcome = await applyHubEvent({
      event,
      reference: body.reference,
      amountMinor: body.amount_minor ?? null,
      currency: body.currency ?? null,
      payload: body,
    })

    if (outcome.ok) {
      await finish(outcome.alreadyDone ? 'already_done' : outcome.state, undefined, outcome.paymentId)
      return NextResponse.json({ ok: true })
    }

    if (outcome.reason === 'not_found') {
      /*
        A reference we do not know. Answering 2xx is deliberate: the hub would
        otherwise retry for 24 hours against a payment this app has never had,
        and the thing that needs to happen is a human looking, not another
        POST.
      */
      await finish('unknown_reference', `No payment carries reference ${body.reference}`)
      return NextResponse.json({ ok: true, unknown: true })
    }

    if (outcome.reason === 'mismatch') {
      await finish('mismatch', outcome.detail, outcome.paymentId)
      reportUnexpected(new Error('Hub payment amount mismatch'), 'hub.confirm', {
        reference: body.reference,
        detail: outcome.detail,
      })
      return NextResponse.json({ ok: true, flagged: true })
    }

    // Our fault, and a later attempt may well get past it.
    await finish('error', outcome.message, outcome.paymentId)
    reportUnexpected(new Error(outcome.message), 'hub.confirm', { reference: body.reference })
    return NextResponse.json({ error: 'Could not apply the event' }, { status: 500 })
  } catch (error) {
    await finish('error', error instanceof Error ? error.message : 'Unknown error')
    reportUnexpected(error, 'hub.confirm', { reference: body.reference })
    return NextResponse.json({ error: 'Could not apply the event' }, { status: 500 })
  }
}
