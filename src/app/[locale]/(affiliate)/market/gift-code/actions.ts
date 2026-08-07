'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Redeeming a COMMISSION gift code. Cedis, not points.
 *
 * A deliberate near-copy of the ads action rather than a shared one. D27: the
 * two businesses share no function, and this is the reason in miniature — the
 * two differ in the RPC they call, the unit they return, the paths they
 * revalidate and the one refusal below that has no counterpart on the ads
 * side. A single function with a `business` argument would carry four
 * conditionals and pay the wrong balance the first time one was missed.
 *
 * The user id comes from the verified session, never from the payload.
 */
export type RedeemCommissionOutcome =
  | { ok: true; amountMinor: number }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'already_used'
        | 'revoked'
        | 'expired'
        /* No affiliate account. The RPC refuses rather than creating one:
           enrolling somebody in a second business as a side effect of pasting
           a string would stamp a terms acceptance in their name. */
        | 'no_account'
        | 'not_signed_in'
        | 'error'
    }

export async function redeemCommissionGiftCode(
  code: string,
): Promise<RedeemCommissionOutcome> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'not_signed_in' }

  if (typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, reason: 'not_found' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('redeem_commission_gift_code', {
    p_user_id: user.id,
    p_code: code,
  })

  if (error) {
    reportUnexpected(error, 'commission-gift-code.redeem')
    return { ok: false, reason: 'error' }
  }

  const result = (data ?? {}) as { outcome?: string; amount_minor?: number }

  if (result.outcome === 'ok') {
    /* The commission balance shows in three places and the bell changed too. */
    revalidatePath('/market')
    revalidatePath('/commission')
    revalidatePath('/notifications')
    return { ok: true, amountMinor: Number(result.amount_minor ?? 0) }
  }

  const known = ['not_found', 'already_used', 'revoked', 'expired', 'no_account'] as const
  const reason = known.find((r) => r === result.outcome)

  return { ok: false, reason: reason ?? 'error' }
}
