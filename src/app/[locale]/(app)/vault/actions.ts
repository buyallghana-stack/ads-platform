'use server'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { initialiseTransaction } from '@/lib/payments/paystack'
import { createAdminClient } from '@/lib/supabase/admin'

export type VaultCheckoutResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; errorKey?: string; message?: string }

export async function startVaultPaystackCheckout(
  planId: string,
): Promise<VaultCheckoutResult> {
  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  const admin = createAdminClient()

  const { data: payment, error } = await admin.rpc('start_vault_payment', {
    p_user_id: user.id,
    p_plan_id: planId,
  })

  if (error || !payment) {
    return { ok: false, message: error?.message ?? 'Could not initiate vault deposit.' }
  }

  const row = payment as unknown as {
    id: string
    amount_minor: number
    currency_code: string
  }

  const initialised = await initialiseTransaction({
    email: user.email,
    amountMinor: Number(row.amount_minor),
    currency: row.currency_code,
    reference: row.id,
    callbackUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/vault/callback?ref=${row.id}`,
    metadata: {
      user_id: user.id,
      vault_plan_id: planId,
      payment_id: row.id,
    },
  })

  if (!initialised.ok) {
    return { ok: false, message: initialised.message }
  }

  return { ok: true, authorizationUrl: initialised.authorizationUrl }
}

export type ClaimVaultResult =
  | { ok: true; points: number }
  | { ok: false; message: string }

export async function claimVaultInvestmentAction(
  investmentId: string,
): Promise<ClaimVaultResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'You must be signed in to claim returns.' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('claim_vault_investment', {
    p_investment_id: investmentId,
  })

  if (error) {
    return { ok: false, message: error.message }
  }

  const inv = data as unknown as { claimed_points: number }
  return { ok: true, points: Number(inv.claimed_points ?? 0) }
}
