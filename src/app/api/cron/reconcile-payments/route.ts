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
 * "initialized". Older than 48 hours it is marked failed here.
 *
 * WHY FORTY-EIGHT AND NOT THE HUB'S NUMBER. An earlier version of this comment
 * said 48 "matched the hub's abandonment rule". It never did: the hub's window
 * is 24 hours, held in a setting its owner can change from a dashboard without
 * a deploy, so it is not a number to copy. Being the LONGER of the two is the
 * safe direction and is the reason nothing needs to change. The hub asks
 * Paystack before closing anything, so in practice a stale payment comes back
 * from it as `abandoned` at around 24 hours and is closed on the hub's verdict
 * here, hours before this sweep would reach for its own clock. The 48 hour
 * branch below is only for a hub that never gave a verdict at all.
 *
 * ⚠️ NOTHING HERE IS A SECOND WAY TO GRANT A PLAN. It calls the same
 * `settleFromHub` the return page does, which calls the same idempotent
 * fulfilment the confirm endpoint does. Three entry points, one money path.
 *
 * ⚠️ AND IT HAS TO SWEEP BOTH PRODUCTS. Vault deposits moved onto the hub on
 * 18 September 2026 and this route kept listing plans alone, which made the
 * Vault the one path with only two of the three entry points: a buyer who
 * closed the tab AND whose confirm POST never landed would have left a paid
 * deposit pending for good, because nothing would ever hand its reference to
 * `settleFromHub`. Everything below the listing is already kind-agnostic, so
 * the fix is the listing.
 *
 * Guarded by CRON_SECRET, like the other sweeps, because it moves money. It is
 * rung every 15 minutes by `ring_payment_reconciliation()` in pg_cron, not by
 * vercel.json: this is a Hobby plan, whose two daily cron slots are spent.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Younger than this and the payment is probably still in flight. */
const SETTLE_AFTER_MINUTES = 10
/** Older than this and we close it ourselves. Deliberately longer than the
 *  hub's own 24 hour window, never equal to it: see above. */
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

  /* Both tables, same filter. Asked separately rather than through a view,
     because the two have different columns and a view would be a third place
     for "what a stranded payment looks like" to be defined. */
  const stranded = async (table: 'subscription_payments' | 'vault_payments') =>
    admin
      .from(table)
      .select('id, external_reference, created_at')
      .eq('status', 'pending')
      .not('external_reference', 'is', null)
      .lt('created_at', settleBefore)
      .order('created_at', { ascending: true })
      .limit(BATCH)

  const [plans, deposits] = await Promise.all([
    stranded('subscription_payments'),
    stranded('vault_payments'),
  ])

  const error = plans.error ?? deposits.error
  if (error) {
    reportUnexpected(error, 'cron.reconcile-payments.list')
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  /* Oldest first across both, then the same ceiling as before. A payment that
     has been stranded longer is the one closer to being closed on our own
     clock, so it is the one a capped run must not keep missing. */
  const rows = [
    ...(plans.data ?? []).map((row) => ({ ...row, kind: 'subscription' as const })),
    ...(deposits.data ?? []).map((row) => ({ ...row, kind: 'vault' as const })),
  ]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, BATCH)

  const counts = {
    checked: 0,
    confirmed: 0,
    failed: 0,
    reversed: 0,
    gaveUp: 0,
    unreachable: 0,
    /* Broken out because for the next while the only question anybody has
       about this sweep is whether it has ever seen a deposit at all. */
    vaultChecked: 0,
  }

  for (const row of rows) {
    if (row.kind === 'vault') counts.vaultChecked += 1
    const reference = row.external_reference
    if (!reference) continue
    counts.checked += 1

    if (row.created_at < abandonBefore) {
      /* Well past the hub's own window. Ask once more anyway, because "old" is
         not "unpaid", and only close it if the hub still says nothing. */
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
        /* `gave_up`, not `abandoned`. The hub's `abandoned` means it asked
           Paystack and the money was not taken. This one means the hub is
           still saying `initialized` two days later and we closed the row on
           our own clock without any such confirmation, which is a weaker
           thing and should not read like the strong one on the payment row. */
        await applyHubEvent({
          event: 'payment.failed',
          reference,
          payload: { via: 'reconciliation', reason: 'gave_up' },
        })
        counts.gaveUp += 1
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
