import 'server-only'

import { verifyTransaction } from '@/lib/payments/paystack'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Turning a Paystack reference into a delivered product.
 *
 * Deliberately the same shape as `src/lib/payments/confirm.ts`, which does this
 * for plans. Two near-identical files rather than one generic one, because the
 * two buy different things from different tables and the only thing they truly
 * share is the Paystack call — a merged version would be a function with a
 * `kind` parameter branching at every step, which is how the plan path
 * eventually breaks when somebody edits the product path.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER ID IS THE PAYSTACK REFERENCE
 *
 * Same trick the plan flow uses, and it buys idempotency for free: the webhook
 * and the browser callback both arrive carrying the exact row they refer to,
 * with nothing to look up or guess. Whichever gets here first delivers the
 * product; the second is a no-op because `confirm_product_order` refuses an
 * order that is already confirmed.
 *
 * ---------------------------------------------------------------------------
 * THE VISITOR TOKEN IS WHY COMMISSION HAPPENS AT ALL
 *
 * `confirm_product_order` takes it and passes it to `attribute_order`, which is
 * what finds the click that led here and writes the conversion. Without it a
 * sale is still delivered and NOBODY IS PAID — silently, with no error
 * anywhere. It is threaded through every path below for that reason.
 *
 * The webhook has no cookie to read, so it passes null and relies on the
 * account-side binding: a click made while signed in is recorded against the
 * user as well as the visitor token.
 */

export type StartOutcome =
  | { ok: true; orderId: string; amountMinor: number }
  | { ok: false; message: string }

/** Creates the pending order. The AMOUNT COMES FROM THE DATABASE — never from
 *  anything the browser sent, or a tampered client buys a course for a pesewa. */
export async function startProductOrder(
  userId: string,
  productId: string,
  couponCode?: string | null,
): Promise<StartOutcome> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('start_product_order', {
    p_user_id: userId,
    p_product_id: productId,
    p_method: 'paystack',
    /* A string, never a discount. `start_product_order` re-validates it
       against the product it names, the quota, the window and this buyer's own
       history, and works out the money itself. */
    p_coupon_code: couponCode?.trim() || undefined,
  })

  if (error || !data) {
    return { ok: false, message: error?.message ?? 'That order could not be started.' }
  }

  const order = data as unknown as { id: string; amount_minor: number }
  return { ok: true, orderId: order.id, amountMinor: Number(order.amount_minor) }
}

export type ConfirmOutcome =
  | { ok: true; alreadyDone: boolean; productId: string }
  | { ok: false; reason: 'not_paid' | 'not_found' | 'mismatch' | 'error'; message?: string }

export async function confirmProductOrder(
  reference: string,
  visitorToken: string | null,
): Promise<ConfirmOutcome> {
  const admin = createAdminClient()

  // The reference IS the order row id.
  const { data: order } = await admin
    .from('orders')
    .select('id, status, amount_minor, currency_code, product_id')
    .eq('id', reference)
    .maybeSingle()

  if (!order) return { ok: false, reason: 'not_found' }
  if (order.status === 'confirmed') {
    return { ok: true, alreadyDone: true, productId: order.product_id }
  }

  const verified = await verifyTransaction(reference)
  if (!verified.ok) return { ok: false, reason: 'error', message: verified.message }
  if (!verified.paid) return { ok: false, reason: 'not_paid' }

  /*
    Check the money that actually arrived against what was asked for. A course
    is delivered on the strength of this call, and — unlike a plan — delivering
    it also creates an affiliate account and starts a one-year clock. If the
    amount disagrees, grant nothing and leave it for a person.
  */
  if (
    verified.amountMinor !== Number(order.amount_minor) ||
    verified.currency.toUpperCase() !== order.currency_code.trim().toUpperCase()
  ) {
    return { ok: false, reason: 'mismatch' }
  }

  const { error } = await admin.rpc('confirm_product_order', {
    p_order_id: order.id,
    p_provider_ref: reference,
    p_visitor_token: visitorToken ?? undefined,
  })
  if (error) return { ok: false, reason: 'error', message: error.message }

  return { ok: true, alreadyDone: false, productId: order.product_id }
}
