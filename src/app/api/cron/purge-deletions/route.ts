import { NextResponse } from 'next/server'

import { serverEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Carries out account deletions whose 15 days have elapsed.
 *
 * Runs daily from Vercel Cron. Nothing here decides WHETHER to delete — that
 * was decided when the user asked and the grace period ran out untouched; this
 * only executes what is already due, so a missed run delays a deletion rather
 * than losing it.
 *
 * Guarded by CRON_SECRET: the route would otherwise be an unauthenticated
 * endpoint that erases accounts. Vercel sends the secret as a bearer token on
 * its scheduled invocations.
 *
 * ⚠️ IT ALSO RUNS THE PHASE 2 NIGHTLY MAINTENANCE, and that is a workaround
 * rather than a design. The Vercel plan is Hobby: two cron jobs, daily only,
 * and both slots were already taken by this route and `refresh-fx`. Affiliate
 * maintenance — expiring lapsed entitlements, clearing commissions whose hold
 * has passed, warning people whose year is running out — had nowhere to be
 * scheduled, so it rides here.
 *
 * It is deliberately LAST and deliberately cannot fail this route: deletions
 * are a promise in the privacy policy and must not be skipped because a
 * commission did not clear. If a third cron slot ever exists, this belongs in
 * its own route at its own hour.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: due, error } = await admin.rpc('due_account_deletions')
  if (error) {
    /*
      Nobody is watching a cron's response body. If this fails every night,
      accounts that asked to be deleted 15 days ago are silently still here —
      a promise in the privacy policy quietly going unkept.
    */
    reportUnexpected(error, 'cron.purge-deletions.list')
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (due ?? []) as Array<{ user_id: string }>
  const outcomes: Record<string, number> = {}
  const failures: string[] = []

  for (const row of rows) {
    const { data, error: purgeError } = await admin.rpc('finalise_account_deletion', {
      p_user_id: row.user_id,
    })
    if (purgeError) {
      // One bad account must not stop the rest of the batch — but it must not
      // vanish either. The id is the operator's own record, not personal data.
      reportUnexpected(purgeError, 'cron.purge-deletions.account', { userId: row.user_id })
      failures.push(row.user_id)
      continue
    }
    const outcome = (data as { outcome?: string } | null)?.outcome ?? 'unknown'
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
  }

  return NextResponse.json({
    due: rows.length,
    outcomes,
    failures: failures.length,
    ranAt: new Date().toISOString(),
  })
}
