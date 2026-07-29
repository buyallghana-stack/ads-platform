/**
 * The guards every exchange rate passes before anything believes it.
 *
 * Kept out of `fx.ts` because that module is `server-only` — which is correct
 * for something holding provider URLs and making outbound calls, but it also
 * makes the module unimportable from a test runner. These are pure functions
 * over a number, they are the part most worth testing, and there is no reason
 * for them to be locked behind a runtime boundary.
 */

/**
 * The only way a rate becomes a number.
 *
 * CoinGecko answers a currency it does not support with HTTP 200 and the
 * field simply absent — `{"tether":{}}`, reproduced against the live API. So
 * an HTTP check and a try/catch prove nothing: the value arrives as
 * `undefined` through a completely successful request. A zero reaching the
 * quote arithmetic would divide a payout into infinity, and an undefined one
 * would render "NaN USDT" on somebody's withdrawal screen.
 */
export function positiveFinite(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number') return null
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Sanity bounds per pair.
 *
 * "Is it a positive number" does not catch a feed with the decimal point in
 * the wrong place, a test fixture served by mistake, or a depegged asset —
 * all of which arrive as perfectly valid numbers. Deliberately wide: the job
 * is to catch a broken feed, not to second-guess a market.
 */
export const RATE_BOUNDS: Record<string, { min: number; max: number }> = {
  // The cedi has never been near either edge. 1 would be parity with the
  // dollar; 200 would be a collapse an order of magnitude past anything on
  // record.
  USD_GHS: { min: 1, max: 200 },
  // A USD stablecoin outside this is not a rate, it is an incident — and not
  // something to be quoting payouts against either way.
  USDT_USD: { min: 0.5, max: 1.5 },
  USDC_USD: { min: 0.5, max: 1.5 },
}

/** Unknown pairs pass: inventing a bound for an asset nobody has thought
 *  about would reject it for no reason the next time one is added. */
export function withinBounds(pair: string, rate: number): boolean {
  const b = RATE_BOUNDS[pair]
  if (!b) return true
  return rate >= b.min && rate <= b.max
}
