import { NextResponse } from 'next/server'

import { serverEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { fetchCoinUsd, fetchUsdGhs } from '@/lib/pricing/fx'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Refreshes the exchange rates that price crypto withdrawals.
 *
 * Runs once a day, at 05:00 UTC. Two constraints meet here and happen to
 * agree: the project is on a Vercel Hobby plan, where a cron may only fire
 * daily and only two may exist at all (this is the second, after the deletion
 * sweep) — and the fiat provider publishes a new figure once a day anyway,
 * shortly after midnight UTC, so refreshing more often would re-fetch the
 * same number.
 *
 * 05:00 leaves room after the provider's own update and sits against a
 * 36-hour `fx_rate_max_age_hours`, so a single failed run still leaves twelve
 * hours in which users see an estimate while somebody notices.
 *
 * WHICH COINS: whichever are active AND rail-confirmed. Fetching rates for an
 * asset nobody can be paid in wastes a call, and — worse — leaves a fresh
 * rate sitting in the table for a coin that was switched off.
 *
 * A PARTIAL FAILURE IS NOT A FAILURE. If USD→GHS lands and one coin does not,
 * the run stores what it got and reports what it did not. The alternative is
 * discarding a good rate because an unrelated one was unavailable.
 *
 * Guarded by CRON_SECRET like the deletion sweep: the route writes the number
 * that decides what a withdrawal is worth.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: coins, error: coinsError } = await admin
    .from('payout_coins')
    .select('code')
    .eq('is_active', true)
    .eq('rail_confirmed', true)

  if (coinsError) {
    reportUnexpected(coinsError, 'cron.refresh-fx.coins')
    return NextResponse.json({ error: coinsError.message }, { status: 500 })
  }

  const legs = await Promise.all([
    fetchUsdGhs(),
    ...(coins ?? []).map((c) => fetchCoinUsd(c.code)),
  ])

  const stored: string[] = []
  const failed: string[] = []

  for (const leg of legs) {
    if (!leg) continue
    const { error } = await admin.rpc('set_fx_rate', {
      p_pair: leg.pair,
      p_rate: leg.rate,
      p_source: leg.source,
    })
    if (error) {
      reportUnexpected(error, 'cron.refresh-fx.store', { pair: leg.pair })
      failed.push(leg.pair)
    } else {
      stored.push(`${leg.pair}=${leg.rate} (${leg.source})`)
    }
  }

  // Name what could not be fetched, rather than only what could. A run that
  // quietly returns 200 having stored nothing looks identical to a healthy
  // one in a cron dashboard.
  const wanted = ['USD_GHS', ...(coins ?? []).map((c) => `${c.code}_USD`)]
  const missing = wanted.filter((pair) => !stored.some((s) => s.startsWith(`${pair}=`)))

  if (missing.length > 0) {
    /*
      Every provider AND every fallback failed for these pairs. Once the
      stored rate ages past fx_rate_max_age_hours the withdraw screen stops
      showing an estimate at all, so this needs to be visible well before
      then.
    */
    reportUnexpected(
      new Error(`refresh-fx could not price: ${missing.join(', ')}`),
      'cron.refresh-fx.missing',
      { missing: missing.join(','), stored: stored.length },
    )
  }

  return NextResponse.json({
    stored,
    missing,
    failed,
    ok: missing.length === 0 && failed.length === 0,
  })
}
