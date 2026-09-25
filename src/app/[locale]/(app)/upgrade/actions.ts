'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { hubInitialise } from '@/lib/payments/hub/client'
import { releaseAllTopupHolds, releaseTopupHold } from '@/lib/payments/topup-hold'
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
 *
 * WHO ACTUALLY TAKES THE MONEY, since 2026-09-16: the Tech Store. Both
 * products sit on one Paystack account, which Paystack asked to be the
 * store's, so this app holds no Paystack key and makes no Paystack call. It
 * asks the store's hub to start the payment and the hub answers with the page
 * to send the buyer to. Everything above this line is unchanged, because the
 * price is still decided here and the hub is only ever told a figure this
 * database has already agreed to. See docs/payment-hub-contract.md.
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

  return handToHub(admin, user.email, payment as unknown as PaymentRow)
}

/**
 * Part from the balance, the rest through Paystack.
 *
 * For a buyer whose balance does not reach the price. `start_plan_topup_payment`
 * sets the balance part aside and leaves only the remainder on the payment row,
 * so what the hub is asked to charge is exactly what is left. The points come
 * back on their own (a trigger, migration 240) if that payment fails or is
 * reversed, and the plan is granted by the usual confirmation when it succeeds.
 */
export async function startPlanTopupCheckout(
  tierId: string,
  amountMinor?: number,
  couponCode?: string,
): Promise<CheckoutResult> {
  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  /* A buyer who cancelled on Paystack and tries again would otherwise find
     their balance still held by the first attempt, and be told it is empty. */
  const cleared = await clearHolds(user.id)
  if (cleared) return { ok: false, message: cleared }

  const admin = createAdminClient()

  const { data: payment, error } = await admin.rpc('start_plan_topup_payment', {
    p_user_id: user.id,
    p_tier_id: tierId,
    p_amount_minor: Number.isFinite(amountMinor) ? amountMinor : undefined,
    p_coupon_code: couponCode?.trim() || undefined,
  })

  if (error || !payment) {
    return { ok: false, message: error?.message ?? 'Could not start this payment.' }
  }

  return handToHub(admin, user.email, payment as unknown as PaymentRow)
}

type PaymentRow = { id: string; amount_minor: number; currency_code: string }

const HUB_UNREACHABLE =
  'We could not check your unfinished payment just now. Please try again in a moment.'

/** Null when every held part-balance payment was closed or found paid. */
async function clearHolds(userId: string): Promise<string | null> {
  try {
    await releaseAllTopupHolds(userId)
    return null
  } catch (error) {
    reportUnexpected(error, 'upgrade.releaseHolds', { userId })
    return HUB_UNREACHABLE
  }
}

/**
 * Cancelling an unfinished part-balance payment and getting the balance back.
 *
 * The hub is asked first: if the payment did go through, the plan is granted
 * and the buyer is told so, rather than being handed back points they spent.
 */
export type CancelHoldResult =
  | { ok: true; outcome: 'released' | 'paid' | 'not_held' }
  | { ok: false; message: string }

export async function cancelTopupHold(paymentId: string): Promise<CancelHoldResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'You must be signed in.' }

  try {
    const outcome = await releaseTopupHold(user.id, paymentId)
    revalidatePath('/[locale]/(app)/upgrade', 'page')
    revalidatePath('/[locale]/(app)/dashboard', 'page')
    return { ok: true, outcome }
  } catch (error) {
    reportUnexpected(error, 'upgrade.cancelHold', { paymentId })
    return { ok: false, message: HUB_UNREACHABLE }
  }
}

/** Everything after the payment row exists: the same for a full Paystack
 *  purchase and for the remainder of a part-balance one. */
async function handToHub(
  admin: ReturnType<typeof createAdminClient>,
  customerEmail: string,
  row: PaymentRow,
): Promise<CheckoutResult> {
  /*
    The payment row's id is what the hub is told as `external_ref`, so its
    answer always names the exact row it refers to. Asking twice for the same
    id returns the payment already running rather than starting a second one,
    which is what makes a reloaded checkout page harmless.
  */
  const initialised = await hubInitialise({
    externalRef: row.id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency_code.trim(),
    customerEmail,
    returnUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/payments/return`,
  })

  if (!initialised.ok) {
    /* A retryable fault is the hub's or the network's, and the row is left
       pending so the reconciliation sweep can finish it if the payment did in
       fact start. Only a refusal we know is final marks the row failed, and
       for a part-balance payment that also returns the points it held. */
    if (!initialised.retryable) {
      await admin
        .from('subscription_payments')
        .update({ status: 'failed', failure_reason: initialised.message })
        .eq('id', row.id)
    }

    /*
      ⚠️ THE HUB'S WORDING DOES NOT GO TO THE BUYER.

      Its message for a refused payment is "Could not reach the payment
      provider", and it says that when Paystack simply would not accept the
      customer's EMAIL. Passing it through tells somebody their payment failed
      for a reason that is not true, and sends support looking for an outage.

      The real text is kept where it is useful: on the payment row, and in the
      error report. What the buyer gets is one sentence they can act on.
    */
    reportUnexpected(new Error(initialised.message), 'upgrade.checkout', {
      paymentId: row.id,
      refused: initialised.refused,
      retryable: initialised.retryable,
    })
    return { ok: false, errorKey: initialised.refused ? 'refused' : 'failed' }
  }

  /* The hub's reference is stored BEFORE the user leaves, because it is the
     only thing the return page and the confirm endpoint carry. Losing it here
     would mean a paid customer we cannot match to a plan. */
  const { error: attachError } = await admin.rpc('attach_hub_reference', {
    p_payment_id: row.id,
    p_reference: initialised.reference,
  })
  if (attachError) {
    return { ok: false, message: 'Could not start this payment. Please try again.' }
  }

  return { ok: true, authorizationUrl: initialised.authorizationUrl }
}

/**
 * Buying a plan with the account balance instead of Paystack.
 *
 * Same inputs as the Paystack checkout and the same distrust of them: the
 * amount and coupon are re-checked in SQL by `start_subscription_payment`,
 * which `purchase_plan_with_balance` calls, and the plan is granted by the same
 * `confirm_subscription_payment` a card payment ends in. The points debit, the
 * payment row and the plan are one transaction, so a short balance leaves
 * nothing behind. See migration 239.
 *
 * The SQL raises carry sentences written for the buyer (short balance, plan
 * cap, disabled account), so they are passed through as the Vault's are.
 */
export type BalancePurchaseResult = { ok: true } | { ok: false; message: string }

export async function purchasePlanWithBalance(
  tierId: string,
  amountMinor?: number,
  couponCode?: string,
): Promise<BalancePurchaseResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'You must be signed in to buy a plan.' }

  /* Balance still set aside by an unfinished part-balance checkout is the
     buyer's, and this purchase may need it. See lib/payments/topup-hold.ts. */
  const cleared = await clearHolds(user.id)
  if (cleared) return { ok: false, message: cleared }

  const admin = createAdminClient()
  const { error } = await admin.rpc('purchase_plan_with_balance', {
    p_user_id: user.id,
    p_tier_id: tierId,
    p_amount_minor: Number.isFinite(amountMinor) ? amountMinor : undefined,
    p_coupon_code: couponCode?.trim() || undefined,
  })

  if (error) {
    return { ok: false, message: error.message }
  }

  revalidatePath('/[locale]/(app)/upgrade', 'page')
  revalidatePath('/[locale]/(app)/dashboard', 'page')
  return { ok: true }
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
    p_product_id: null as unknown as string,
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
