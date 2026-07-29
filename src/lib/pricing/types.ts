/**
 * Shared shape for crypto payout pricing.
 *
 * Lives apart from `quote.ts` because that module is `server-only` and the
 * withdraw wizard is a client component. `import type` is erased before
 * bundling so it would probably survive, but "probably" is how this repo
 * previously broke a build importing admin preview data into a client
 * component — a type in its own file costs nothing and cannot fail.
 */
export type CryptoQuote = {
  coin: string
  /** Cedis per US dollar. */
  ghsPerUsd: number
  /** Dollars per unit of the coin — not assumed to be 1 even for a stablecoin. */
  coinUsd: number
  /** Operator margin, already applied by the quote function's arithmetic. */
  spreadPct: number
  /** The older of the two legs, so the age shown is the honest one. */
  quotedAt: string
}
