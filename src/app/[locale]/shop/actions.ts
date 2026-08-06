'use server'

import { revalidatePath } from 'next/cache'

import { getViewAsSession } from '@/lib/admin/view-as'
import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { initialiseTransaction } from '@/lib/payments/paystack'
import { getOrigin } from '@/lib/request-context'
import { startProductOrder } from '@/lib/market/orders'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createUserClient } from '@/lib/supabase/server'

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

/**
 * Save or unsave a product.
 *
 * Through the RLS user client rather than the service key, unusually for Phase
 * 2 — `saved_products` is genuinely "own rows", the policy says so, and routing
 * a bookmark through an admin client would mean the server deciding whose
 * shortlist to write on the strength of an id in the payload. Here the database
 * decides, from the caller's own token.
 *
 * A toggle rather than separate add/remove: the button has one state and one
 * meaning, and two actions would let the UI and the row disagree about which.
 */
export async function toggleSaveAction(productId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser()
  if (!user) return { ok: false }
  if (await getViewAsSession()) return { ok: false }

  const supabase = await createUserClient()

  const { data: existing } = await supabase
    .from('saved_products')
    .select('product_id')
    .eq('product_id', productId)
    .maybeSingle()

  const { error } = existing
    ? await supabase.from('saved_products').delete().eq('product_id', productId)
    : await supabase.from('saved_products').insert({ user_id: user.id, product_id: productId })

  if (error) {
    reportUnexpected(error, 'shop.toggleSave', { productId })
    return { ok: false }
  }

  revalidatePath('/shop')
  return { ok: true }
}
