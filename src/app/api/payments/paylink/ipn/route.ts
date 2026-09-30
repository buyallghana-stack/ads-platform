import { NextResponse } from 'next/server'

import { z } from 'zod'

import { paylinkConfigured, paylinkIpnSecrets } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import type { PaylinkPayment, PaylinkPayout } from '@/lib/payments/paylink/client'
import { applyPaylinkPayment } from '@/lib/payments/paylink/fulfil'
import { applyPaylinkPayout } from '@/lib/payments/paylink/payouts'
import { PAYLINK_SIGNATURE_HEADER, verifyPaylinkSignature } from '@/lib/payments/paylink/signature'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * PayLink telling us a payment or a payout changed.
 *
 * Anyone on the internet can post here. The signature is checked against the
 * RAW body before anything is parsed, and a failure is a 401.
 *
 * DELIVERY IS AT LEAST ONCE, AND A RETRY KEEPS ITS event_id.
 * PayLink retries at 1m, 5m, 15m, 1h, 6h, 12h and 24h until it gets a 2xx,
 * always with the same event_id and body (only the signature is fresh). So:
 *
 *   * An event whose first delivery reached a final result is answered 2xx
 *     and not touched again.
 *   * An event whose first delivery failed on OUR side is processed again.
 *     Burning the id first, as the hub route does, would skip it forever.
 *   * Two deliveries racing each other is harmless: everything underneath is
 *     idempotent by payment or payout.
 *
 * 2xx MEANS STOP, NOT "IT WORKED". A wrong amount, a wrong mode or an order we
 * do not know answers 2xx and is flagged for an admin, because retrying it for
 * a day will not change it. Only a fault on our side answers 500.
 *
 * PayLink waits 10 seconds for an answer. Everything here is a few indexed
 * reads and one RPC, and nothing slow (SMS, email) runs before the answer.
 */
export const dynamic = 'force-dynamic'

const eventSchema = z.object({
  event_id: z.string().min(1).max(200),
  type: z.enum(['payment.updated', 'payout.updated']),
  livemode: z.boolean(),
  created_at: z.string(),
  data: z.record(z.string(), z.unknown()),
})

const paymentSchema = z.object({
  payment_id: z.string().min(1),
  order_id: z.string().min(1),
  status: z.enum(['waiting', 'confirming', 'partially_paid', 'finished', 'expired', 'failed', 'refunded']),
  livemode: z.boolean(),
  price_amount: z.string(),
  price_currency: z.string(),
})

const payoutSchema = z.object({
  payout_id: z.string().min(1),
  payout_ref: z.uuid(),
  status: z.enum(['queued', 'held_for_review', 'sending', 'completed', 'rejected', 'failed']),
  livemode: z.boolean(),
})

/** Results after which a repeat delivery is only a repeat. */
const FINAL = new Set(['applied', 'already_done', 'ignored', 'unknown_order', 'mismatch', 'mode_mismatch'])
/** A `received` row older than this is a delivery that died half way. */
const STALE_MS = 60_000

export async function POST(request: Request) {
  const secrets = paylinkIpnSecrets()
  if (secrets.length === 0 || !paylinkConfigured()) {
    /* Not configured is not forged. 503 asks PayLink to come back, which is
       what is wanted while a deploy is missing its secret. */
    return NextResponse.json({ error: 'PayLink is not configured here' }, { status: 503 })
  }

  const raw = await request.text()
  const verified = verifyPaylinkSignature({
    secrets,
    rawBody: raw,
    header: request.headers.get(PAYLINK_SIGNATURE_HEADER),
  })
  if (!verified.ok) {
    return NextResponse.json({ error: 'Invalid signature', reason: verified.reason }, { status: 401 })
  }

  let event: z.infer<typeof eventSchema>
  try {
    event = eventSchema.parse(JSON.parse(raw))
  } catch {
    /* Signed by PayLink and still unreadable: a contract change, not an
       attack. 400 so it shows as failed on PayLink's side. */
    return NextResponse.json({ error: 'Unreadable event' }, { status: 400 })
  }

  const admin = createAdminClient()
  const events = admin.from('paylink_events' as never)

  /* ---- Dedupe by event_id ------------------------------------------- */
  const objectId =
    typeof event.data.payment_id === 'string'
      ? event.data.payment_id
      : typeof event.data.payout_id === 'string'
        ? event.data.payout_id
        : null

  const { error: insertError } = await events.insert({
    event_id: event.event_id,
    type: event.type,
    livemode: event.livemode,
    object_id: objectId,
    status: typeof event.data.status === 'string' ? event.data.status : null,
    payload: event as never,
  } as never)

  if (insertError) {
    if (insertError.code !== '23505') {
      reportUnexpected(insertError, 'paylink.ipn', { step: 'record', eventId: event.event_id })
      return NextResponse.json({ error: 'Could not record the event' }, { status: 500 })
    }
    const { data: seen } = await events
      .select('result, updated_at, deliveries')
      .eq('event_id', event.event_id)
      .maybeSingle()
    const prior = seen as { result: string; updated_at: string; deliveries: number } | null
    if (prior && FINAL.has(prior.result)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    if (prior?.result === 'received' && Date.now() - Date.parse(prior.updated_at) < STALE_MS) {
      /* Another delivery of this event is being processed right now. Ask
         PayLink to come back rather than doing the same work twice at once. */
      return NextResponse.json({ error: 'Already in progress' }, { status: 409 })
    }
    await events
      .update({ result: 'received', deliveries: (prior?.deliveries ?? 1) + 1, updated_at: new Date().toISOString() } as never)
      .eq('event_id', event.event_id)
  }

  const finish = async (fields: {
    result: string
    detail?: string
    rowId?: string
    rowKind?: 'subscription' | 'vault' | 'redemption'
  }) => {
    await events
      .update({
        result: fields.result,
        detail: fields.detail ?? null,
        ...(fields.rowId ? { row_id: fields.rowId } : {}),
        ...(fields.rowKind ? { row_kind: fields.rowKind } : {}),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('event_id', event.event_id)
  }

  try {
    if (event.type === 'payment.updated') {
      const parsed = paymentSchema.safeParse(event.data)
      if (!parsed.success) {
        await finish({ result: 'error', detail: 'The payment object was not in the documented shape' })
        return NextResponse.json({ error: 'Unreadable payment' }, { status: 400 })
      }

      const outcome = await applyPaylinkPayment(event.data as unknown as PaylinkPayment, 'ipn')
      if (outcome.ok) {
        await finish({
          result: outcome.alreadyDone ? 'already_done' : 'applied',
          detail: outcome.state,
          rowId: outcome.rowId,
          rowKind: outcome.kind,
        })
        return NextResponse.json({ ok: true })
      }
      if (outcome.reason === 'unknown_order') {
        await finish({ result: 'unknown_order', detail: outcome.detail })
        return NextResponse.json({ ok: true, unknown: true })
      }
      if (outcome.reason === 'mismatch' || outcome.reason === 'mode_mismatch') {
        await finish({ result: outcome.reason, detail: outcome.detail, rowId: outcome.rowId, rowKind: outcome.kind })
        reportUnexpected(new Error(`PayLink payment ${outcome.reason}`), 'paylink.ipn', {
          eventId: event.event_id,
          detail: outcome.detail,
        })
        return NextResponse.json({ ok: true, flagged: true })
      }
      await finish({ result: 'error', detail: outcome.message, rowId: outcome.rowId, rowKind: outcome.kind })
      reportUnexpected(new Error(outcome.message), 'paylink.ipn', { eventId: event.event_id })
      return NextResponse.json({ error: 'Could not apply the event' }, { status: 500 })
    }

    const parsed = payoutSchema.safeParse(event.data)
    if (!parsed.success) {
      await finish({ result: 'error', detail: 'The payout object was not in the documented shape' })
      return NextResponse.json({ error: 'Unreadable payout' }, { status: 400 })
    }

    const outcome = await applyPaylinkPayout(event.data as unknown as PaylinkPayout, 'ipn')
    if (outcome.ok) {
      const result =
        outcome.result === 'unknown'
          ? 'unknown_order'
          : outcome.result === 'already_done'
            ? 'already_done'
            : 'applied'
      await finish({ result, detail: outcome.result, rowId: parsed.data.payout_ref, rowKind: 'redemption' })
      if (outcome.result === 'anomaly' || outcome.result === 'conflict') {
        reportUnexpected(new Error(`PayLink payout ${outcome.result}`), 'paylink.ipn', { eventId: event.event_id })
      }
      return NextResponse.json({ ok: true })
    }
    if (outcome.reason === 'mode_mismatch') {
      await finish({ result: 'mode_mismatch', detail: outcome.message, rowId: parsed.data.payout_ref, rowKind: 'redemption' })
      reportUnexpected(new Error('PayLink payout mode mismatch'), 'paylink.ipn', { eventId: event.event_id })
      return NextResponse.json({ ok: true, flagged: true })
    }
    await finish({ result: 'error', detail: outcome.message, rowId: parsed.data.payout_ref, rowKind: 'redemption' })
    return NextResponse.json({ error: 'Could not apply the event' }, { status: 500 })
  } catch (error) {
    await finish({ result: 'error', detail: error instanceof Error ? error.message : 'Unknown error' })
    reportUnexpected(error, 'paylink.ipn', { eventId: event.event_id })
    return NextResponse.json({ error: 'Could not apply the event' }, { status: 500 })
  }
}
