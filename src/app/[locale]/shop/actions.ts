'use server'

import { getViewAsSession } from '@/lib/admin/view-as'
import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { initialiseTransaction } from '@/lib/payments/paystack'
import { getOrigin } from '@/lib/request-context'
import { startProductOrder } from '@/lib/market/orders'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Buying a product.
 *
 * ---------------------------------------------------------------------------
 * THE PRICE IS NEVER SENT FROM THE BROWSER
 *
 * This action takes a product id and nothing else. `start_product_order` reads
 * the price out of the products table — applying any live sale — and writes it
 * onto the order. Paystack is then charged the amount on that ROW.
 *
 * So there is no request a tampered client can make that buys a GHS 400 course
 * for one pesewa: the only number it controls is which product, and the answer
 * to "what does that cost" never leaves the server.
 *
 * ---------------------------------------------------------------------------
 * REFUSED WHILE VIEWING AS SOMEBODY ELSE
 *
 * Middleware already blocks every non-GET while the viewing cookie is set, so
 * this is the second of two locks. It is here because a server action reached
 * by any other path would otherwise let an administrator start a real charge
 * against a user's account.
 */

export type BuyResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string }

export async function buyProductAction(productId: string): Promise<BuyResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'Sign in to buy this.' }
  if (await getViewAsSession()) {
    return { ok: false, message: 'You are viewing another account and cannot buy anything.' }
  }

  const admin = createAdminClient()

  /*
    Refuse a second purchase of something already owned, before taking money.
    `grant_order_entitlements` is idempotent so a duplicate would not create a
    second entitlement — but it WOULD create a second confirmed order, which
    means a real charge for nothing and a refund conversation.
  */
  const { data: owned } = await admin.rpc('has_entitlement', {
    p_user_id: user.id,
    p_product_id: productId,
  })
  if (owned) return { ok: false, message: 'You already own this.' }

  const started = await startProductOrder(user.id, productId)
  if (!started.ok) return { ok: false, message: started.message }

  /*
    A free product has nothing to charge for. Sending a zero-amount transaction
    to Paystack is refused by them anyway, so it is confirmed here directly —
    the order still exists, still attributes, and still grants entitlements.
  */
  if (started.amountMinor <= 0) {
    const { error } = await admin.rpc('confirm_product_order', {
      p_order_id: started.orderId,
      p_provider_ref: `free-${started.orderId}`,
    })
    if (error) {
      reportUnexpected(error, 'shop.confirmFree', { productId })
      return { ok: false, message: error.message }
    }
    return { ok: true, redirectTo: `/shop/thanks?order=${started.orderId}` }
  }

  const origin = await getOrigin()
  const charge = await initialiseTransaction({
    // The order id IS the reference. That is what makes the webhook and the
    // browser callback idempotent against each other.
    reference: started.orderId,
    email: user.email ?? '',
    amountMinor: started.amountMinor,
    currency: 'GHS',
    callbackUrl: `${origin}/api/shop/callback`,
    metadata: { orderId: started.orderId, productId, userId: user.id },
  })

  if (!charge.ok) {
    reportUnexpected(new Error(charge.message), 'shop.initialise', { productId })
    return { ok: false, message: charge.message }
  }

  return { ok: true, redirectTo: charge.authorizationUrl }
}
