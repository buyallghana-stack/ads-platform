import type { useFormatter } from 'next-intl'

import type { PayoutRequest } from '@/lib/admin/types'

/**
 * What a payout is worth, in the unit it will actually be sent in.
 *
 * Operator rule, 2026-07-29: "if the withdrawal is made in USDT or USDC make
 * it show the amount in the respective currency or coin not cedis, cedis is
 * for the mobile money option only."
 *
 * ONE DEFINITION, USED TWICE, ON PURPOSE. The drawer headline and the
 * confirmation sentence an operator reads before releasing money both come
 * from here. Two formatters would eventually disagree, and the failure would
 * be an operator confirming one amount and sending another.
 *
 * THE FALLBACK ORDER MATTERS:
 *   1. `coinAmount` — frozen when the user asked. This is what they were
 *      quoted and what should be sent.
 *   2. `liveCoinAmount` — only exists when nothing was frozen, because no
 *      fresh rate existed at request time. Flagged, because nobody has been
 *      promised this figure.
 *   3. cedis — when there is no coin figure at all. Wrong unit, but a number
 *      with an explanation beats an empty space where an amount should be.
 */
export type PayoutHeadline = {
  /** The amount, formatted, in the unit it will be sent in. */
  primary: string
  /** A translation key to show beneath it, when the figure needs qualifying. */
  caveat?: 'drawer.quoteLive' | 'drawer.quoteMissing'
}

/* Derived from next-intl's own formatter rather than hand-written. A
   hand-rolled `{ number(...) }` shape looks equivalent and is not: next-intl
   narrows NumberFormatOptions further than Intl does, so the two are
   incompatible and the mismatch only shows up at the call site. */
type Formatter = Pick<ReturnType<typeof useFormatter>, 'number'>

export function payoutHeadline(request: PayoutRequest, format: Formatter): PayoutHeadline {
  /*
    THE NET, NOT THE GROSS. Since 2026-08-01 a withdrawal can carry a fee for
    transaction costs and taxes, and this function answers "what do I send?" —
    the gross is what left the user's balance, which is a different question
    and not one anybody is acting on here. On a row filed before fees existed
    the two are equal, so nothing about the past changes.
  */
  const cedis = `GHS ${format.number(request.netGhs, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  if (request.method !== 'crypto') return { primary: cedis }

  const coin = request.coin ?? ''

  /*
    Two decimals reads as money and matches what the user was shown on the
    withdraw screen. The stored value keeps 8dp — this is the display, not
    the amount of record, and the operator copies the destination rather than
    retyping the figure.
  */
  const asCoin = (n: number) =>
    `${format.number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${coin}`.trim()

  if (request.coinAmount !== undefined) {
    return { primary: asCoin(request.coinAmount) }
  }

  if (request.liveCoinAmount !== undefined) {
    return { primary: asCoin(request.liveCoinAmount), caveat: 'drawer.quoteLive' }
  }

  return { primary: cedis, caveat: 'drawer.quoteMissing' }
}
