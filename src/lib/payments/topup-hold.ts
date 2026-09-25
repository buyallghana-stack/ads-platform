import 'server-only'

import { settleFromHub } from '@/lib/payments/hub/resolve'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Giving back balance a part-balance checkout set aside (migration 240).
 *
 * Operator, 2026-09-25: a buyer cancelled on Paystack and their balance
 * "vanished". It had not; it was held by a payment still `pending`, and the
 * hub keeps an unfinished payment open for 24 hours before calling it
 * abandoned, so the points only came back a day later. That is too long to
 * hold somebody's money for a checkout they walked away from.
 *
 * So a buyer can close their own unfinished part-balance payment, and starting
 * a new balance purchase closes any old one first.
 *
 * ⚠️ THE HUB IS ASKED FIRST, EVERY TIME. Closing a payment that quietly
 * succeeded would hand back the points AND leave the cash half unmatched. So
 * each one goes through `settleFromHub`, which asks the hub (and through it
 * Paystack): a success is granted as the plan it paid for, and only a payment
 * still unfinished is closed here. Marking it `failed` is what returns the
 * points, through the trigger, so there is one release path and not two.
 *
 * What remains possible is a buyer who closes it here and then completes the
 * old Paystack page anyway. That arrives as a late success: the trigger takes
 * the points again, or if they are gone grants the plan and raises
 * `plan_balance_part_unrecovered` for an admin. The cash half is never lost.
 */

export type HeldTopup = {
  id: string
  balanceMinor: number
  currencyCode: string
  createdAt: string
}

export async function getHeldTopups(userId: string): Promise<HeldTopup[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscription_payments')
    .select('id, balance_minor, currency_code, created_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('balance_held', true)
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id,
    balanceMinor: Number(row.balance_minor ?? 0),
    currencyCode: row.currency_code.trim(),
    createdAt: row.created_at,
  }))
}

export type ReleaseOutcome = 'released' | 'paid' | 'not_held'

/** Closes one unfinished part-balance payment belonging to `userId`. */
export async function releaseTopupHold(
  userId: string,
  paymentId: string,
): Promise<ReleaseOutcome> {
  const admin = createAdminClient()

  const { data: row } = await admin
    .from('subscription_payments')
    .select('id, user_id, status, balance_held, external_reference')
    .eq('id', paymentId)
    .maybeSingle()

  /* Somebody else's payment reads exactly like a missing one. */
  if (!row || row.user_id !== userId || row.status !== 'pending' || !row.balance_held) {
    return 'not_held'
  }

  if (row.external_reference) {
    const settled = await settleFromHub(row.external_reference)
    if (settled.state === 'confirmed') return 'paid'
    /* Could not reach the hub: do not guess. The buyer can try again, and the
       sweep closes it in the end either way. */
    if (settled.state === 'pending' && settled.unreachable) {
      throw new Error('The payment hub could not be reached to check this payment.')
    }
  }

  /* Conditional on still being pending, so a confirmation that lands between
     the question above and this write wins, and nothing is released. */
  await admin
    .from('subscription_payments')
    .update({ status: 'failed', failure_reason: 'Cancelled by the buyer before paying' })
    .eq('id', paymentId)
    .eq('status', 'pending')

  return 'released'
}

/** Closes every unfinished part-balance payment the buyer has. */
export async function releaseAllTopupHolds(userId: string): Promise<void> {
  for (const held of await getHeldTopups(userId)) {
    await releaseTopupHold(userId, held.id)
  }
}
