/**
 * Amounts on the PayLink wire.
 *
 * PayLink sends and takes amounts as STRINGS ("150.00", "1.234567") and asks
 * that they never pass through a floating-point number. This app stores cedis
 * as integer pesewas on payments and as `numeric(18,2)` on withdrawals. These
 * are the only conversions between the two, and they are string and integer
 * arithmetic from end to end.
 *
 * Pure, so the tests exercise them without a database.
 */

/* BigInt() rather than 100n literals: the project targets ES2017. */
const ZERO = BigInt(0)
const HUNDRED = BigInt(100)

/** 52000 pesewas → "520.00". */
export function pesewasToAmount(minor: number | bigint | string): string | null {
  let value: bigint
  try {
    value = BigInt(minor)
  } catch {
    return null
  }
  if (value <= ZERO) return null
  const whole = value / HUNDRED
  const part = (value % HUNDRED).toString().padStart(2, '0')
  return `${whole}.${part}`
}

/**
 * "520.00" or "520" or "520.5" → 52000n / 52050n. Anything else is null, never
 * a guess: an amount this cannot read is a refusal downstream, not a zero.
 */
export function amountToPesewas(amount: unknown): bigint | null {
  if (typeof amount !== 'string') return null
  const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(amount.trim())
  if (!match) return null
  const [, whole, fraction = ''] = match
  return BigInt(whole!) * HUNDRED + BigInt(fraction.padEnd(2, '0'))
}

/**
 * A `numeric(18,2)` as Postgres or supabase-js hands it over (a string, or a
 * JS number for small values) → "12.50". Goes through `amountToPesewas`, so a
 * number with more than two decimals is refused rather than rounded.
 */
export function cedisToAmount(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : value
  const minor = amountToPesewas(text)
  return minor === null ? null : pesewasToAmount(minor)
}
