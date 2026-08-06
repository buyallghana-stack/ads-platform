'use server'

import { getLocale, getTranslations } from 'next-intl/server'

import { getSessionUser } from '@/lib/auth/session'
import { initialiseTransaction } from '@/lib/payments/paystack'
import { startProductOrder } from '@/lib/market/orders'
import { getOrigin } from '@/lib/request-context'

/**
 * Buying a product.
 *
 * ── EVERY AMOUNT COMES FROM THE DATABASE ──
 *
 * `startProductOrder` reads the price server-side and writes the order row; the
 * only thing that crosses from the browser is a product id. Nothing here trusts
 * a number the client sent, because a client that can name its own price can
 * buy a GHS 400 programme for a pesewa.
 *
 * ── THE ORDER ID IS THE PAYSTACK REFERENCE ──
 *
 * Same trick the plan flow uses. It buys idempotency for free: the webhook and
 * the browser callback both arrive carrying the exact row they refer to, and
 * whichever lands first delivers the product.
 *
 * ⚠️ The visitor cookie is NOT read here and must not be. It is read at
 * CONFIRMATION, where it is passed to `attribute_order` — that is the moment
 * the commission is decided. Reading it now and stashing it would introduce a
 * second copy of the one value the whole affiliate business depends on.
 */
export type BuyResult = { ok: true; url: string } | { ok: false; message: string }

export async function startCheckout(productId: string): Promise<BuyResult> {
  const t = await getTranslations('affiliate.public')
  const locale = await getLocale()

  const user = await getSessionUser()
  if (!user) return { ok: false, message: t('mustSignIn') }

  const order = await startProductOrder(user.id, productId)
  if (!order.ok) return { ok: false, message: order.message }

  /*
    A free product has nothing to charge for. Paystack refuses a zero amount,
    so sending one there produces an opaque gateway error on a screen the buyer
    reads as "my card was declined".
  */
  if (order.amountMinor <= 0) {
    return { ok: false, message: t('freeNotSupported') }
  }

  const origin = await getOrigin()
  const started = await initialiseTransaction({
    reference: order.orderId,
    email: user.email ?? '',
    amountMinor: order.amountMinor,
    currency: 'GHS',
    callbackUrl: `${origin}/${locale}/p/callback`,
    metadata: { kind: 'product', product_id: productId, user_id: user.id },
  })

  if (!started.ok) return { ok: false, message: started.message }
  return { ok: true, url: started.authorizationUrl }
}
