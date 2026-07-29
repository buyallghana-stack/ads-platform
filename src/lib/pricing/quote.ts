import 'server-only'

import type { CryptoQuote } from '@/lib/pricing/types'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The rates behind a crypto withdrawal estimate.
 *
 * Deliberately the RATES and not a finished figure. The wizard re-quotes on
 * every keystroke as somebody types an amount, and a round trip per keystroke
 * would be both slow and pointless — the conversion is linear, so the client
 * can multiply. What the client must NOT be trusted with is deciding whether
 * a rate is fresh enough to use, so that decision stays in the database and
 * this returns null when the answer is no.
 */
export type { CryptoQuote }

/**
 * Asks the database to price one cedi in `coin`.
 *
 * `quote_crypto_payout` owns the staleness rule and the spread, and returns
 * null when either leg is missing or older than `fx_rate_max_age_hours`. The
 * amount passed is 1 only because the caller wants the rates back, not a
 * total; the figures read off the response are unrounded, so scaling them up
 * client-side does not accumulate the rounding a 1-cedi quote would carry.
 */
export async function getCryptoQuote(coin: string | null): Promise<CryptoQuote | null> {
  if (!coin) return null

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('quote_crypto_payout', { p_ghs: 1, p_coin: coin })

  if (error || !data || typeof data !== 'object') return null

  const q = data as Record<string, unknown>
  const ghsPerUsd = Number(q.usd_ghs)
  const coinUsd = Number(q.coin_usd)
  const spreadPct = Number(q.spread_pct ?? 0)
  const quotedAt = typeof q.quoted_at === 'string' ? q.quoted_at : null

  // The database already refused a stale or missing rate; this is the second
  // gate, against a shape that changed or a null that slipped through. A NaN
  // reaching the wizard would render "NaN USDT" on a withdrawal screen.
  if (!Number.isFinite(ghsPerUsd) || ghsPerUsd <= 0) return null
  if (!Number.isFinite(coinUsd) || coinUsd <= 0) return null
  if (!Number.isFinite(spreadPct) || spreadPct < 0) return null
  if (!quotedAt) return null

  return { coin: coin.toUpperCase(), ghsPerUsd, coinUsd, spreadPct, quotedAt }
}
