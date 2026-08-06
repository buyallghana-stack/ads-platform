import { NextResponse } from 'next/server'

import { getVisitorToken } from '@/lib/market/attribution'
import { confirmProductOrder } from '@/lib/market/orders'
import { reportUnexpected } from '@/lib/observability/report'

/**
 * Where Paystack sends the buyer back to.
 *
 * The WEBHOOK is the path that always arrives; this is the path the person is
 * waiting on. Either can complete the purchase and the second is a no-op,
 * because `confirm_product_order` refuses an order that is already confirmed.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONE THAT CAN READ THE COOKIE
 *
 * The webhook is a server-to-server POST with no browser attached, so it has no
 * visitor token to pass. This route does — and the visitor token is how a click
 * becomes a conversion and an affiliate gets paid.
 *
 * That makes this route worth more than convenience: for a buyer who clicked an
 * affiliate link while signed OUT, the cookie is the only binding that exists.
 * If only the webhook ever ran, that sale would deliver correctly and pay
 * nobody.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const reference = url.searchParams.get('reference') ?? url.searchParams.get('trxref')

  if (!reference) {
    return NextResponse.redirect(new URL('/shop', url.origin))
  }

  const visitorToken = await getVisitorToken()
  const outcome = await confirmProductOrder(reference, visitorToken)

  if (!outcome.ok) {
    /*
      Not necessarily a failure the buyer caused. `not_paid` means they backed
      out, which is normal; anything else means money may have moved without a
      product being delivered, and that needs a person.
    */
    if (outcome.reason !== 'not_paid') {
      reportUnexpected(
        new Error(`Shop callback failed: ${outcome.reason}`),
        'shop.callback',
        { reference, reason: outcome.reason },
      )
    }
    return NextResponse.redirect(new URL(`/shop?payment=${outcome.reason}`, url.origin))
  }

  return NextResponse.redirect(new URL(`/shop/thanks?order=${reference}`, url.origin))
}
