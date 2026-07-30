'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Redeeming a gift code.
 *
 * `redeem_gift_code` is revoked from every client role, so this runs through
 * the service client — and the user id comes from the verified session, never
 * from the payload. A client that could name the account being credited would
 * be the whole feature, backwards.
 *
 * The refusals come back as outcomes rather than exceptions because "that code
 * is not valid" is an ordinary thing for somebody to hit, not a fault.
 */
export type RedeemOutcome =
  | { ok: true; points: number }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'already_used'
        | 'revoked'
        | 'expired'
        | 'rate_limited'
        | 'account_disabled'
        | 'not_signed_in'
        | 'error'
    }

export async function redeemGiftCode(code: string): Promise<RedeemOutcome> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'not_signed_in' }

  // Cheap client-side-shaped guard so an empty submit does not spend one of
  // the user's hourly attempts. The database still decides.
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, reason: 'not_found' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('redeem_gift_code', {
    p_user_id: user.id,
    p_code: code,
  })

  if (error) {
    reportUnexpected(error, 'gift-code.redeem')
    return { ok: false, reason: 'error' }
  }

  const result = (data ?? {}) as { outcome?: string; points?: number }

  if (result.outcome === 'ok') {
    // The balance hero, the history and the notification bell all changed.
    revalidatePath('/dashboard')
    revalidatePath('/notifications')
    return { ok: true, points: Number(result.points ?? 0) }
  }

  const known = [
    'not_found',
    'already_used',
    'revoked',
    'expired',
    'rate_limited',
    'account_disabled',
  ] as const
  const reason = known.find((r) => r === result.outcome)

  return { ok: false, reason: reason ?? 'error' }
}
