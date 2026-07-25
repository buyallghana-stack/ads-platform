import 'server-only'

import { verifyTransaction } from '@/lib/payments/paystack'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Turning a Paystack reference into a live subscription.
 *
 * Shared by the browser callback and the webhook because BOTH must be able to
 * complete a purchase on their own. The webhook is the one that always
 * arrives; the callback is the one the user is waiting on. Whichever gets here
 * first grants the plan, and the second is a no-op —
 * confirm_subscription_payment is idempotent by payment id.
 */
export type ConfirmOutcome =
  | { ok: true; alreadyDone: boolean }
  | { ok: false; reason: 'not_paid' | 'not_found' | 'mismatch' | 'error'; message?: string }

export async function confirmPaystackReference(reference: string): Promise<ConfirmOutcome> {
  const admin = createAdminClient()

  // The reference IS the payment row id.
  const { data: payment } = await admin
    .from('subscription_payments')
    .select('id, status, amount_minor, currency_code')
    .eq('id', reference)
    .maybeSingle()

  if (!payment) return { ok: false, reason: 'not_found' }
  if (payment.status === 'confirmed') return { ok: true, alreadyDone: true }

  const verified = await verifyTransaction(reference)
  if (!verified.ok) return { ok: false, reason: 'error', message: verified.message }
  if (!verified.paid) return { ok: false, reason: 'not_paid' }

  /*
    Check the money that actually arrived against what we asked for. Paystack
    would not normally disagree, but a subscription is granted on the strength
    of this call — if the amount or currency does not match the row, something
    is wrong and the safe move is to grant nothing and leave it for a human.
  */
  if (
    verified.amountMinor !== Number(payment.amount_minor) ||
    verified.currency.toUpperCase() !== payment.currency_code.trim().toUpperCase()
  ) {
    return { ok: false, reason: 'mismatch' }
  }

  const { error } = await admin.rpc('confirm_subscription_payment', {
    p_payment_id: payment.id,
    p_reference: reference,
    p_payload: verified.raw as never,
  })
  if (error) return { ok: false, reason: 'error', message: error.message }

  return { ok: true, alreadyDone: false }
}
