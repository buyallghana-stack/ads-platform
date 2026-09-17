/**
 * The judgements this app makes about what the hub says, with nothing else in
 * them.
 *
 * Pure and import free on purpose. Everything here decides whether a plan may
 * be granted, and until now those decisions lived inside `fulfil.ts` beside a
 * database call, so the only way to exercise them was to have a database.
 * A rule that is awkward to test is a rule that gets tested once.
 *
 * THE FAULT THAT PUT THIS FILE HERE, Tech Store letter, 17 September 2026.
 * Their guard comparing what Paystack reported against what the intent
 * recorded required only that both amounts were finite numbers. `Number("")`
 * and `Number(null)` are both `0`, so two MISSING amounts compared equal and
 * read as a match: the check that exists to catch a payment at the wrong
 * amount passed a payment with no amount at all.
 *
 * Ours could not fail in exactly that way, because `subscription_payments`
 * declares `amount_minor bigint not null check (amount_minor > 0)` and the
 * expected side therefore cannot be absent. It failed in the other direction
 * instead, which is worse: `Number(input.amountMinor ?? expected)` compared
 * the expected amount against ITSELF whenever the hub stated no amount, so a
 * `payment.success` carrying no figure was granted with no check performed.
 * Nothing announced it, because from the outside a skipped check and a passed
 * check look identical.
 *
 * So both sides are read the same way here: a positive whole number of minor
 * units, or nothing. `0`, `""`, `null`, `NaN`, a float and a negative are all
 * "nothing", and nothing is never equal to anything.
 */

export type AmountVerdict =
  | { ok: true; minor: number; currency: string }
  | { ok: false; detail: string }

export type PaystackMode = 'live' | 'test' | 'unknown'

/**
 * Minor units as a positive whole number, or null when there is no readable
 * amount.
 *
 * ⚠️ THE TYPE GUARD IS THE POINT, not the range check after it. `Number` says
 * `0` for `null`, `""`, `" "`, `[]` and `false`, and `1` for `true`. Feeding
 * it an unknown and testing the result is how the fault above happened, so
 * anything that is not already a number or a string is refused before any
 * coercion runs.
 */
export function readMinorUnits(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (!Number.isInteger(parsed)) return null
  if (parsed <= 0) return null
  return parsed
}

/** An ISO 4217 code, uppercased, or null. `char(3)` in the database, so padding is trimmed. */
export function readCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

/** Minor units as an operator reads them. Pesewas in the comparison, cedis in the sentence. */
const inMajor = (minor: number) => (minor / 100).toFixed(2)

/**
 * Is the money the hub describes the money this row asked for?
 *
 * Called only for `payment.success`. A failure or a reversal carries the
 * original amount for context, and refusing to act on a reversal because a
 * figure disagreed would leave a refunded payment holding a live plan.
 *
 * Every `ok: false` here is a flag for an admin rather than an error for the
 * hub: the endpoint still answers 2xx, because retrying a wrong amount for 24
 * hours cannot turn it into a right one.
 */
export function checkSuccessAmount(input: {
  expectedMinor: unknown
  expectedCurrency: unknown
  statedMinor: unknown
  statedCurrency: unknown
}): AmountVerdict {
  const expected = readMinorUnits(input.expectedMinor)
  const wantCurrency = readCurrency(input.expectedCurrency)

  /* Our own row is unreadable. The column is `not null check (> 0)` so this
     should be unreachable, and it is checked anyway: the one thing that must
     not happen is an unreadable expectation quietly becoming a match. */
  if (expected === null || wantCurrency === null) {
    return {
      ok: false,
      detail:
        'This app has no readable amount for that payment, so nothing could be ' +
        'compared. Nothing was granted.',
    }
  }

  const stated = readMinorUnits(input.statedMinor)
  const gotCurrency = readCurrency(input.statedCurrency)

  /* The hub told us a payment succeeded without saying what was paid. That is
     a contract violation rather than a wrong figure, so it is worth its own
     sentence: an admin reading "the hub reported GHS 0.00" would go looking
     for a zero payment that never existed. */
  if (stated === null || gotCurrency === null) {
    const missing = [
      stated === null ? 'an amount' : null,
      gotCurrency === null ? 'a currency' : null,
    ].filter(Boolean)

    return {
      ok: false,
      detail:
        `The hub reported a success without ${missing.join(' or ')}. ` +
        `Expected ${wantCurrency} ${inMajor(expected)}. Nothing was granted.`,
    }
  }

  if (stated !== expected || gotCurrency !== wantCurrency) {
    /* ⚠️ MAJOR UNITS IN THE SENTENCE, MINOR UNITS IN THE COMPARISON.
       Everything on this path is integer pesewas, and the first version of
       this message printed them raw: "Expected 23000 GHS, the hub reported
       100 GHS" for a GHS 230.00 plan charged GHS 1.00. Out by a factor of a
       hundred, on the one line an admin reads to decide whether a payment is
       wrong. Caught by looking at the admin screen rather than by a test. */
    return {
      ok: false,
      detail:
        `Expected ${wantCurrency} ${inMajor(expected)}, ` +
        `the hub reported ${gotCurrency} ${inMajor(stated)}`,
    }
  }

  return { ok: true, minor: expected, currency: wantCurrency }
}

/*
  Where `domain` can appear. Paystack stamps live or test on every transaction
  object it returns, and the hub stores the whole object, so the field exists
  somewhere in most shapes the hub could forward. It is NOT in the contract
  yet (docs/payment-hub-contract.md), which is why `unknown` is an answer and
  not a failure.
*/
const DOMAIN_AT: readonly string[][] = [
  ['domain'],
  ['data', 'domain'],
  ['paystack', 'domain'],
  ['paystack_payload', 'domain'],
  ['provider_payload', 'domain'],
]

/**
 * Live money or test money, as far as anything we were sent can tell.
 *
 * WHY THIS EXISTS AT ALL. The Tech Store's Paystack account was in test mode
 * in production from the beginning, and neither side could see it: the secret
 * key cannot be read back out of the deployment, and a test key produces
 * webhooks and signatures indistinguishable from live ones. Six SidePerks
 * payments were reported successful, delivered over a valid signature, and
 * granted plans. No money moved for any of them.
 *
 * Nothing malfunctioned. The hub reported what Paystack told it, and this app
 * believed the hub, and both were right to. What was missing was anyone
 * asking WHICH Paystack. So this app asks now, and `unknown` stays permissive
 * because the hub does not send the field yet: making absence fatal would
 * refuse every real payment to guard against a case we cannot yet see.
 */
export function paystackMode(payload: unknown): PaystackMode {
  for (const path of DOMAIN_AT) {
    let node: unknown = payload
    for (const key of path) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        node = undefined
        break
      }
      node = (node as Record<string, unknown>)[key]
    }
    if (typeof node !== 'string') continue

    const value = node.trim().toLowerCase()
    if (value === 'live') return 'live'
    if (value === 'test') return 'test'
  }
  return 'unknown'
}

/** What an admin reads on a payment refused for being test money. */
export function testModeDetail(reference: string): string {
  return (
    `The hub reported this as paid on a Paystack account in TEST mode, so no ` +
    `money moved. Reference ${reference}. No plan was granted. Turn on ` +
    `"accept test payments" in platform settings if this is a rehearsal.`
  )
}
