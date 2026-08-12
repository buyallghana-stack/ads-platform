'use server'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { initialiseTransaction } from '@/lib/payments/paystack'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Starting a plan purchase.
 *
 * The browser sends which plan AND how much — because since 2026-08-04 the
 * amount is part of the product: what you pay inside a plan's band decides
 * what an ad is worth to you.
 *
 * WHICH MAKES THE AMOUNT EXACTLY THE FIELD A TAMPERED REQUEST WOULD CHANGE.
 * It is not trusted here: `start_subscription_payment` re-reads the plan's
 * band from the tiers table and refuses anything outside it, so the worst a
 * forged request can do is pay a legal price for the plan it names. The
 * currency and period still come from the tier, and the user id from the
 * verified session, never from the payload.
 */
export type CheckoutResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; errorKey?: string; message?: string }

export async function startPaystackCheckout(
  tierId: string,
  amountMinor?: number,
  couponCode?: string,
): Promise<CheckoutResult> {
  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  const admin = createAdminClient()

  const { data: payment, error } = await admin.rpc('start_subscription_payment', {
    p_user_id: user.id,
    p_tier_id: tierId,
    p_method: 'paystack',
    // Undefined means "the floor price", which is what the database defaults
    // to — the cheapest way into the band, never the dearest.
    p_amount_minor: Number.isFinite(amountMinor) ? amountMinor : undefined,
    /* The code is re-validated in SQL against the quota, the window, the plan
       it names and this user's own history. What the browser sends is a
       string, never a discount. */
    p_coupon_code: couponCode?.trim() || undefined,
  })

  if (error || !payment) {
    // These raises carry human-readable text (disabled account, inactive tier).
    return { ok: false, message: error?.message ?? 'Could not start this payment.' }
  }

  const row = payment as unknown as {
    id: string
    amount_minor: number
    currency_code: string
  }

  const initialised = await initialiseTransaction({
    // The payment row's id doubles as the Paystack reference, so the webhook
    // and callback both name the exact row they are confirming.
    reference: row.id,
    email: user.email,
    amountMinor: Number(row.amount_minor),
    currency: row.currency_code.trim(),
    callbackUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/upgrade/payment`,
    metadata: { payment_id: row.id, tier_id: tierId, user_id: user.id },
  })

  if (!initialised.ok) {
    await admin
      .from('subscription_payments')
      .update({ status: 'failed', failure_reason: initialised.message })
      .eq('id', row.id)
    return { ok: false, message: initialised.message }
  }

  return { ok: true, authorizationUrl: initialised.authorizationUrl }
}

/**
 * What a code would do to this purchase, before anybody pays.
 *
 * ⚠️ THE SAME FUNCTION THE CHECKOUT USES. `coupon_quote` is what
 * `start_subscription_payment` applies through `take_coupon`, so the price
 * previewed here is the price that will be charged. A separate preview would
 * eventually promise a discount the database refuses, and the buyer would find
 * out on the Paystack page.
 *
 * Quoting is not reserving: the place in the quota is only taken when the
 * checkout starts, so somebody typing a code and walking away holds nothing.
 */
export type CouponPreview =
  | { ok: true; discountMinor: number; chargedMinor: number }
  | { ok: false; reason: string }

export async function previewPlanCoupon(
  tierId: string,
  amountMinor: number,
  code: string,
): Promise<CouponPreview> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'unknown' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('coupon_quote', {
    p_user_id: user.id,
    p_code: code.trim(),
    p_tier_id: tierId,
    /* `null`, not `undefined`. supabase-js drops undefined keys and PostgREST
       then cannot match the overload, which fails as "function not found"
       rather than as a bad argument. */
    p_product_id: null,
    p_amount_minor: amountMinor,
  })

  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) return { ok: false, reason: 'unknown' }
  if (!row.ok) return { ok: false, reason: row.reason ?? 'unknown' }

  return {
    ok: true,
    discountMinor: Number(row.discount_minor),
    chargedMinor: Number(row.charged_minor),
  }
}
