import { NextResponse } from 'next/server'

import { paylinkConfigured, serverEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { getPaylinkPayout } from '@/lib/payments/paylink/client'
import { applyPaylinkPayout, sendPaylinkPayout } from '@/lib/payments/paylink/payouts'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Automatic crypto payouts, every five minutes.
 *
 * Rung by `ring_paylink_payouts()` in pg_cron, like the payment sweep, because
 * this Hobby plan's two Vercel cron slots are spent. Guarded by CRON_SECRET,
 * because it moves money.
 *
 * FOUR PASSES, IN ORDER
 *   1. Holds that have elapsed become `pending_approval`
 *      (`release_matured_holds`, which nothing else runs on a clock).
 *   2. Each new USDC-on-Base withdrawal gets its automatic decision
 *      (`auto_approve_redemption`): approved when every payout rule passes,
 *      left for an admin with the failing rules written down when not.
 *   3. Every approved USDC-on-Base withdrawal not yet sent is sent, whether
 *      the system or an admin approved it. This also retries sends that died
 *      in flight.
 *   4. Payouts PayLink has not finished are asked about, in case an IPN was
 *      lost. The IPN is the fast path; this is the one that cannot be missed.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A ceiling per pass, so one run cannot outlast the function timeout. */
const BATCH = 20
/** Ask PayLink about an unfinished payout no more often than this. */
const POLL_AFTER_MINUTES = 10

type Row = { id: string }

export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const counts = { released: 0, autoApproved: 0, needsReview: 0, sent: 0, notSent: 0, retry: 0, polled: 0 }

  /* 1 ------------------------------------------------------------------ */
  const { data: released, error: releaseError } = await admin.rpc('release_matured_holds')
  if (releaseError) reportUnexpected(releaseError, 'cron.paylink-payouts', { step: 'release' })
  counts.released = Number(released ?? 0)

  /* 2 ------------------------------------------------------------------ */
  const { data: undecided, error: listError } = await admin
    .from('redemptions')
    .select('id')
    .eq('status', 'pending_approval')
    .eq('method', 'crypto')
    .ilike('snapshot_coin_code', 'usdc')
    .ilike('snapshot_network_code', 'base')
    .is('auto_decision' as never, null)
    .order('created_at', { ascending: true })
    .limit(BATCH)
  if (listError) {
    reportUnexpected(listError, 'cron.paylink-payouts', { step: 'list_undecided' })
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }

  for (const row of (undecided ?? []) as Row[]) {
    const { data, error } = await admin.rpc('auto_approve_redemption' as never, { p_redemption_id: row.id } as never)
    if (error) {
      reportUnexpected(error, 'cron.paylink-payouts', { step: 'decide', redemptionId: row.id })
      continue
    }
    if (data === 'auto_approved') counts.autoApproved += 1
    if (data === 'needs_review') counts.needsReview += 1
  }

  /* Without PayLink and both licence switches there is nothing to send, and
     the decisions above are still worth making: an admin sees the reasons. */
  if (!paylinkConfigured() || !serverEnv().PAYOUTS_ENABLED) {
    return NextResponse.json({ ok: true, sending: false, ...counts })
  }

  /* 3 ------------------------------------------------------------------ */
  const stale = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data: toSend } = await admin
    .from('redemptions')
    .select('id')
    .eq('status', 'approved')
    .eq('method', 'crypto')
    .ilike('snapshot_coin_code', 'usdc')
    .ilike('snapshot_network_code', 'base')
    .or(`paylink_status.is.null,and(paylink_status.eq.requesting,paylink_claimed_at.lt."${stale}")` as never)
    .order('reviewed_at', { ascending: true })
    .limit(BATCH)

  for (const row of (toSend ?? []) as Row[]) {
    const outcome = await sendPaylinkPayout(row.id)
    if (outcome === 'sent') counts.sent += 1
    else if (outcome === 'not_sent') counts.notSent += 1
    else if (outcome === 'retry_later') counts.retry += 1
    else if (outcome === 'payouts_disabled') break
  }

  /* 4 ------------------------------------------------------------------ */
  const pollBefore = new Date(Date.now() - POLL_AFTER_MINUTES * 60_000).toISOString()
  const { data: open } = await admin
    .from('redemptions')
    .select('id, paylink_payout_id' as never)
    .eq('status', 'approved')
    .in('paylink_status' as never, ['queued', 'held_for_review', 'sending'] as never)
    .lt('paylink_updated_at' as never, pollBefore as never)
    .order('paylink_updated_at' as never, { ascending: true })
    .limit(BATCH)

  for (const row of (open ?? []) as unknown as { id: string; paylink_payout_id: string }[]) {
    const current = await getPaylinkPayout(row.paylink_payout_id)
    if (!current.ok) continue
    await applyPaylinkPayout(current.data, 'sweep', row.id)
    counts.polled += 1
  }

  return NextResponse.json({ ok: true, sending: true, ...counts })
}
