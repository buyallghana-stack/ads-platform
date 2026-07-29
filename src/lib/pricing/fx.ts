import 'server-only'

/**
 * Exchange rates for crypto payouts, fetched from public providers.
 *
 * TWO HOPS, BECAUSE NOBODY QUOTES CRYPTO INTO CEDIS FOR FREE. CoinGecko
 * supports 63 fiat currencies and GHS is not one of them. So: coin→USD from a
 * crypto source, USD→GHS from a fiat source, and the payout function
 * multiplies them.
 *
 * EVERY PROVIDER HAS A FALLBACK, and the fallbacks are from different
 * companies on purpose. Two endpoints at one provider go down together.
 *
 * EVERY PATH ENDS AT `positiveFinite` AND `withinBounds`, in
 * `./validate.ts`. CoinGecko answers an unsupported currency with HTTP 200
 * and the field simply absent, so status codes and try/catch prove nothing
 * here — see that file for what the guards are actually for.
 */

import { positiveFinite, withinBounds } from '@/lib/pricing/validate'

export type FxLeg = { pair: string; rate: number; source: string }

const TIMEOUT_MS = 8_000

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
      // These are prices; a cached one defeats the point of refreshing.
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    // Timeout, DNS, TLS, malformed JSON — all the same to the caller, which
    // is going to try the other provider regardless.
    return null
  }
}

const pick = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    o,
  )

/* ------------------------------------------------------------------ */
/* USD → GHS                                                           */
/* ------------------------------------------------------------------ */

async function usdGhsFromErApi(): Promise<FxLeg | null> {
  const data = await getJson('https://open.er-api.com/v6/latest/USD')
  // This one reports failure in the body with a 200, too.
  if (pick(data, 'result') !== 'success') return null
  const rate = positiveFinite(pick(data, 'rates', 'GHS'))
  return rate === null ? null : { pair: 'USD_GHS', rate, source: 'open.er-api.com' }
}

async function usdGhsFromCoinbase(): Promise<FxLeg | null> {
  const data = await getJson('https://api.coinbase.com/v2/exchange-rates?currency=USD')
  const rate = positiveFinite(pick(data, 'data', 'rates', 'GHS'))
  return rate === null ? null : { pair: 'USD_GHS', rate, source: 'coinbase' }
}

/* ------------------------------------------------------------------ */
/* coin → USD                                                          */
/* ------------------------------------------------------------------ */

/** CoinGecko addresses assets by its own slug, not by ticker. */
const COINGECKO_IDS: Record<string, string> = {
  USDT: 'tether',
  USDC: 'usd-coin',
}

async function coinUsdFromCoinGecko(code: string): Promise<FxLeg | null> {
  const id = COINGECKO_IDS[code]
  if (!id) return null
  const data = await getJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
  )
  const rate = positiveFinite(pick(data, id, 'usd'))
  return rate === null ? null : { pair: `${code}_USD`, rate, source: 'coingecko' }
}

async function coinUsdFromCoinbase(code: string): Promise<FxLeg | null> {
  const data = await getJson(`https://api.coinbase.com/v2/exchange-rates?currency=${code}`)
  const rate = positiveFinite(pick(data, 'data', 'rates', 'USD'))
  return rate === null ? null : { pair: `${code}_USD`, rate, source: 'coinbase' }
}

/* ------------------------------------------------------------------ */

async function firstGood(
  pair: string,
  attempts: Array<() => Promise<FxLeg | null>>,
): Promise<FxLeg | null> {
  for (const attempt of attempts) {
    const leg = await attempt()
    // A provider that answers with a number outside the bounds is treated as
    // not having answered, so the fallback still gets its turn.
    if (leg && withinBounds(pair, leg.rate)) return leg
  }
  return null
}

export const fetchUsdGhs = (): Promise<FxLeg | null> =>
  firstGood('USD_GHS', [usdGhsFromErApi, usdGhsFromCoinbase])

export const fetchCoinUsd = (code: string): Promise<FxLeg | null> =>
  firstGood(`${code}_USD`, [
    () => coinUsdFromCoinGecko(code),
    () => coinUsdFromCoinbase(code),
  ])

