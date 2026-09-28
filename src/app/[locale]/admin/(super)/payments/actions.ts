'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { settleFromHub } from '@/lib/payments/hub/resolve'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Ask the hub again about one payment.
 *
 * ⚠️ THIS IS NOT A SECOND WAY TO GRANT A PLAN. It calls `settleFromHub`, the
 * same function the return page and the reconciliation sweep call, which calls
 * the same idempotent fulfilment the hub's confirm endpoint does. Four entry
 * points, one money path. An admin pressing this button cannot produce an
 * outcome the system would not have reached on its own; it only makes it
 * happen now instead of within fifteen minutes.
 *
 * What it is actually for: a customer on the phone saying they paid. Rather
 * than waiting for the sweep, an admin asks the hub and gets today's answer.
 */

export type RecheckResult =
  | { ok: true; state: string; unreachable: boolean }
  | { ok: false; message: string }

export async function recheckWithHub(reference: string): Promise<RecheckResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  /*
    The admin check is asked of the database rather than trusted from the
    session, and it is `assert_admin`, which means SUPER admin. This reaches a
    money path, so it fails closed the same way every other money action does.
  */
  const admin = createAdminClient()
  const { error: notAdmin } = await admin.rpc('assert_admin', { p_admin_id: user.id })
  if (notAdmin) return { ok: false, message: 'Not an administrator.' }

  if (!reference.trim()) return { ok: false, message: 'That payment has no hub reference.' }

  try {
    const settled = await settleFromHub(reference)
    revalidatePath('/admin/payments')
    return { ok: true, state: settled.state, unreachable: settled.unreachable === true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not reach the hub.',
    }
  }
}

/* ---------------------------------------------------------------------------
   Manual mobile money: the operator checked their phone and says yes or no.

   Confirm calls `confirm_subscription_payment`, the function the hub's
   confirmation calls, so the plan, the referral commission and every side
   effect are exactly what a Paystack payment produces. Reject closes the row
   with `fail_subscription_payment`. Both are super admin only, like every
   other money action.
--------------------------------------------------------------------------- */

export type ManualDecision = { ok: true } | { ok: false; message: string }

async function superAdmin(): Promise<string | null> {
  const user = await getSessionUser()
  if (!user) return null
  const { error } = await createAdminClient().rpc('assert_admin', { p_admin_id: user.id })
  return error ? null : user.id
}

export async function confirmManualPayment(kind: 'plan' | 'vault', paymentId: string): Promise<ManualDecision> {
  const adminId = await superAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator.' }
  const admin = createAdminClient()
  const table = kind === 'vault' ? 'vault_payments' : 'subscription_payments'

  const { data: row } = await admin.from(table).select('id, manual_reference').eq('id', paymentId).maybeSingle()
  const reference = (row as unknown as { manual_reference: string | null } | null)?.manual_reference
  if (!row || !reference) return { ok: false, message: 'That is not a manual payment.' }

  const args = {
    p_payment_id: paymentId,
    p_reference: reference,
    p_payload: { manual: true, confirmed_by: adminId } as never,
  }
  const { error } =
    kind === 'vault'
      ? await admin.rpc('confirm_vault_payment', args)
      : await admin.rpc('confirm_subscription_payment', args)
  if (error) return { ok: false, message: error.message }
  revalidatePath('/admin/payments')
  return { ok: true }
}

/**
 * Declining closes the row. Any points taken from the buyer's balance come
 * back through the hold triggers (trg_plan_balance_hold, trg_vault_balance_hold).
 */
export async function rejectManualPayment(kind: 'plan' | 'vault', paymentId: string): Promise<ManualDecision> {
  const adminId = await superAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator.' }
  const admin = createAdminClient()
  const reason = `Manual payment rejected by an administrator (${adminId})`
  const { error } =
    kind === 'vault'
      ? await admin.rpc('fail_vault_payment', { p_payment_id: paymentId, p_reason: reason })
      : await admin.rpc('fail_subscription_payment', { p_payment_id: paymentId, p_reason: reason })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/admin/payments')
  return { ok: true }
}
