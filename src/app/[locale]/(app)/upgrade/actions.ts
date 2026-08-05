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
