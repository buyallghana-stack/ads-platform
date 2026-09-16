import { NextResponse } from 'next/server'

import { serverEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { applyHubEvent } from '@/lib/payments/hub/fulfil'
import { settleFromHub } from '@/lib/payments/hub/resolve'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The payment that nobody finished.
 *
 * Two things can go wrong at once and this is the only thing that catches the
 * pair: the buyer closes the tab on the way back from the bank, so the return
 * page never runs, AND the hub's forward fails long enough to give up. The
 * money left the buyer either way. This sweep asks the hub about every payment
 * still sitting at `pending` and finishes it.
 *
 * WHY TEN MINUTES. A payment younger than that is very likely still happening:
 * the buyer is on the Paystack page, or the confirm endpoint is one second
 * behind. Asking the hub about it wastes a call and can only ever answer
 * "initialized". Older than 48 hours it is marked failed, matching the hub's
 * own abandonment rule so the two sides do not disagree about what a stale
 * intent means.
 *
 * ⚠️ NOTHING HERE IS A SECOND WAY TO GRANT A PLAN. It calls the same
 * `settleFromHub` the return page does, which calls the same idempotent
 * fulfilment the confirm endpoint does. Three entry points, one money path.
 *
 * Guarded by CRON_SECRET, like the other sweeps, because it moves money.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Younger than this and the payment is probably still in flight. */
const SETTLE_AFTER_MINUTES = 10
/** Older than this and the hub has given up too. */
const ABANDON_AFTER_HOURS = 48
/** A ceiling per run, so one sweep cannot run past the function timeout. */
const BATCH = 40

export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = Date.now()
  const settleBefore = new Date(now - SETTLE_AFTER_MINUTES * 60_000).toISOString()
  const abandonBefore = new Date(now - ABANDON_AFTER_HOURS * 3_600_000).toISOString()

  const { data: rows, error } = await admin
    .from('subscription_payments')
    .select('id, external_reference, created_at')
    .eq('status', 'pending')
    .not('external_reference', 'is', null)
    .lt('created_at', settleBefore)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    reportUnexpected(error, 'cron.reconcile-payments.list')
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const counts = { checked: 0, confirmed: 0, failed: 0, reversed: 0, abandoned: 0, unreachable: 0 }

  for (const row of rows ?? []) {
    const reference = row.external_reference
    if (!reference) continue
    counts.checked += 1

    if (row.created_at < abandonBefore) {
      /* Past the point where the hub itself gives up. Ask once more anyway,
         because "old" is not "unpaid", and only mark it abandoned if the hub
         still has nothing. */
      const settled = await settleFromHub(reference)
      if (settled.state === 'confirmed') {
        counts.confirmed += 1
        continue
      }
      if (settled.unreachable) {
        counts.unreachable += 1
        continue
      }
      if (settled.state === 'pending') {
        await applyHubEvent({
          event: 'payment.failed',
          reference,
          payload: { via: 'reconciliation', reason: 'abandoned' },
        })
        counts.abandoned += 1
        continue
      }
      counts.failed += 1
      continue
    }

    const settled = await settleFromHub(reference)
    if (settled.unreachable) counts.unreachable += 1
    else if (settled.state === 'confirmed') counts.confirmed += 1
    else if (settled.state === 'failed') counts.failed += 1
    else if (settled.state === 'reversed') counts.reversed += 1
  }

  return NextResponse.json({ ok: true, ...counts })
}
