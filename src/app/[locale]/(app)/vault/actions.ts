'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { initialiseTransaction } from '@/lib/payments/paystack'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * ⚠️ THE ONE PAYSTACK CALL LEFT IN THIS APP, AND IT MUST STAY OFF IN
 * PRODUCTION.
 *
 * Plans go through the Tech Store hub precisely so that nothing sent to
 * Paystack can reveal SidePerks. This path predates the hub and does the
 * opposite: it hands Paystack a `sideperks.org/vault/callback` URL and
 * metadata naming a vault plan, on the store's own account.
 *
 * It was survivable while the shared account was in test mode. Live keys
 * arrived on 17 September 2026 and the operator's decision was to leave THIS
 * app keyless: with no `PAYSTACK_SECRET_KEY` the card button is not rendered
 * (`checkoutEnabled` on the vault page) and a Vault plan is bought with
 * balance, which is the whole product anyway.
 *
 * So do not add the variable back to this project's environment to "fix" a
 * missing button. Either leave it off, or move this path onto the hub the way
 * `upgrade/actions.ts` did.
 */
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

export type VaultBalancePurchaseResult =
  | { ok: true; investmentId: string }
  | { ok: false; message: string }

export async function purchaseVaultWithBalanceAction(
  planId: string,
): Promise<VaultBalancePurchaseResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'You must be signed in to purchase a Vault plan.' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('purchase_vault_with_balance', {
    p_plan_id: planId,
    p_user_id: user.id,
  })

  if (error) {
    return { ok: false, message: error.message }
  }

  const row = data as unknown as { id: string }
  revalidatePath('/[locale]/(app)/vault', 'page')
  revalidatePath('/[locale]/(app)/dashboard', 'page')
  return { ok: true, investmentId: row?.id }
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
  revalidatePath('/[locale]/(app)/vault', 'page')
  revalidatePath('/[locale]/(app)/dashboard', 'page')
  return { ok: true, points: Number(inv.claimed_points ?? 0) }
}
