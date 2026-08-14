import 'server-only'

import { verifyTransaction } from '@/lib/payments/paystack'
import { createAdminClient } from '@/lib/supabase/admin'

export type ConfirmVaultOutcome =
  | { ok: true; alreadyDone: boolean }
  | { ok: false; reason: 'not_paid' | 'not_found' | 'mismatch' | 'error'; message?: string }

export async function confirmVaultPaystackReference(reference: string): Promise<ConfirmVaultOutcome> {
  const admin = createAdminClient()

  // The reference IS the payment row id.
  const { data: payment } = await admin
    .from('vault_payments')
    .select('id, status, amount_minor, currency_code')
    .eq('id', reference)
    .maybeSingle()

  if (!payment) return { ok: false, reason: 'not_found' }
  if (payment.status === 'confirmed') return { ok: true, alreadyDone: true }

  const verified = await verifyTransaction(reference)
  if (!verified.ok) return { ok: false, reason: 'error', message: verified.message }
  if (!verified.paid) return { ok: false, reason: 'not_paid' }

  if (
    verified.amountMinor !== Number(payment.amount_minor) ||
    verified.currency.toUpperCase() !== payment.currency_code.trim().toUpperCase()
  ) {
    return { ok: false, reason: 'mismatch' }
  }

  const { error } = await admin.rpc('confirm_vault_payment', {
    p_payment_id: payment.id,
    p_reference: reference,
    p_payload: verified.raw as never,
  })
  if (error) return { ok: false, reason: 'error', message: error.message }

  return { ok: true, alreadyDone: false }
}
