'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { hubInitialise } from '@/lib/payments/hub/client'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Starting a Vault deposit.
 *
 * ⚠️ THIS PATH USED TO BE THE ONE PAYSTACK CALL LEFT IN THIS APP, AND IT BROKE
 * THE RULE THE HUB EXISTS TO KEEP. It handed Paystack a
 * `sideperks.org/vault/callback` URL and metadata naming a vault plan, on the
 * store's own account, when nothing sent to Paystack may reveal SidePerks. It
 * was survivable while the shared account was in test mode; the live keys
 * arrived on 17 September 2026 and it stopped being survivable.
 *
 * Since 18 September 2026 a deposit goes out exactly as a plan does: the price
 * comes from `start_vault_payment`, the row's id is the `external_ref`, and the
 * Tech Store hub answers with the page to send the buyer to. This app holds no
 * Paystack key and makes no Paystack call.
 *
 * ⚠️ THE RETURN URL IS THE PLAN'S, AND IT HAS TO BE. The hub keeps an allowlist
 * of return URLs and refuses anything else with a 422, so a Vault deposit
 * cannot have its own address without the store changing its allowlist first.
 * `/payments/return` settles either kind and says Vault or plan on the page,
 * which is why it can be shared.
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

  /* Asking the hub twice for the same id returns the deposit already running
     rather than starting a second one, which is what makes a reloaded checkout
     page harmless. */
  const initialised = await hubInitialise({
    externalRef: row.id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency_code.trim(),
    customerEmail: user.email,
    returnUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/payments/return`,
  })

  if (!initialised.ok) {
    /* A retryable fault is the hub's or the network's, and the row is left
       pending so the reconciliation sweep can finish it if the deposit did in
       fact start. Only a refusal we know is final closes the row. */
    if (!initialised.retryable) {
      await admin.rpc('fail_vault_payment', {
        p_payment_id: row.id,
        p_reason: initialised.message,
      })
    }

    /* ⚠️ The hub's wording does not go to the buyer. Its message for a refused
       payment is "Could not reach the payment provider", and it says that when
       Paystack simply would not accept the customer's email. The real text is
       kept on the payment row and in the error report. */
    reportUnexpected(new Error(initialised.message), 'vault.checkout', {
      paymentId: row.id,
      refused: initialised.refused,
      retryable: initialised.retryable,
    })
    return { ok: false, errorKey: initialised.refused ? 'refused' : 'failed' }
  }

  /* The hub's reference is stored BEFORE the user leaves, because it is the
     only thing the return page and the confirm endpoint carry. Losing it here
     would mean a paid deposit we cannot match to anybody. */
  const { error: attachError } = await admin.rpc('attach_vault_hub_reference', {
    p_payment_id: row.id,
    p_reference: initialised.reference,
  })
  if (attachError) {
    return { ok: false, message: 'Could not start this deposit. Please try again.' }
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
