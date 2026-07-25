/**
 * Payout destinations: how they are stored, and how much of one an operator
 * is allowed to see.
 *
 * THE RULE (operator, 2026-07-25)
 * A payout destination is never printed in full in a list. It is masked to
 * its leading and trailing characters, and the full value appears only when
 * somebody deliberately asks for it, one request at a time.
 *
 * WHY THE MIDDLE AND NOT THE ENDS
 * The operator has to do three things with a destination and none of them
 * need the whole string:
 *
 *   1. Recognise the network — a Ghanaian MoMo number announces its network
 *      in the first three digits (024 MTN, 020 Telecel, 026 AirtelTigo), so
 *      the leading digits are the useful ones, not decoration.
 *   2. Match it against what the user says their account is — people quote
 *      the last digits of their own number, which is why the tail stays.
 *   3. Spot the same account turning up under two different users — the head
 *      plus the tail is a strong enough fingerprint for that, and `reuse`
 *      on the request does the counting properly anyway.
 *
 * Paying the money is the one job that needs the whole value, and that is
 * exactly the moment a reveal is justified.
 *
 * Pure functions, no React, no server bindings — the table, the drawer and
 * (later) the server action all mask identically because they all call this.
 */

import type { PayoutRequest } from './types'

/** The dot used for a masked character. U+2022, not a full stop. */
const DOT = '•'

/**
 * Keep `lead` characters at the front and `tail` at the back, replace the
 * rest with dots.
 *
 * The dot run is capped at `maxDots` so a long crypto address does not turn
 * into a 26-dot smear that wrecks the column width, but for short values the
 * run stays exactly as long as what it hides — a masked phone number that is
 * still ten glyphs long still reads as a phone number.
 */
export function maskMiddle(value: string, lead: number, tail: number, maxDots = 4): string {
  const clean = value.trim()
  const hidden = clean.length - lead - tail

  // Too short to mask meaningfully. Showing head+tail of a 6-character string
  // would leak nearly all of it, so hide the lot rather than pretend.
  if (hidden < 2) return DOT.repeat(Math.max(clean.length, 4))

  return clean.slice(0, lead) + DOT.repeat(Math.min(hidden, maxDots)) + clean.slice(-tail)
}

/**
 * The masked form of a request's destination.
 *
 *   mobile money  024••••567   — 3 leading, 3 trailing, length preserved
 *   crypto        TR7NHq••••Lj6t — 6 leading, 4 trailing, the wallet idiom
 *
 * Mobile money keeps its true length because ten glyphs is part of how a
 * Ghanaian phone number is recognised. A crypto address is 34 characters and
 * nobody reads it as a whole, so it gets the shortened ellipsis every block
 * explorer uses; the head and tail are what a user checks anyway when they
 * confirm the wallet they pasted.
 */
export function maskDestination(request: Pick<PayoutRequest, 'method' | 'destination'>): string {
  return request.method === 'crypto'
    ? maskMiddle(request.destination, 6, 4, 4)
    : maskMiddle(request.destination, 3, 3, 4)
}

/**
 * How long a revealed destination stays revealed.
 *
 * It re-masks itself rather than waiting to be closed, because the realistic
 * failure is not a hacker — it is an operator who opened a payout, walked
 * away, and left somebody's phone number on a screen in an office. Long
 * enough to copy it into the MoMo app, short enough that the screen does not
 * sit there exposed.
 */
export const REVEAL_SECONDS = 30

/** Human label for the rail a payout leaves by. */
export function methodLabel(request: Pick<PayoutRequest, 'method' | 'provider'>): string {
  return request.provider
}

/**
 * Does the name on the payout account match the name on the profile?
 *
 * Deliberately loose: middle names, order and case vary constantly on real
 * MoMo registrations, so this asks whether every part of the shorter name
 * appears in the longer one. A `false` here is a prompt to look, not a
 * verdict — which is why the UI words it as "check", never "fraud".
 */
export function nameMatches(profileName: string, accountName: string): boolean {
  const parts = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)

  const a = parts(profileName)
  const b = parts(accountName)
  if (a.length === 0 || b.length === 0) return false

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.every((p) => longer.includes(p))
}
