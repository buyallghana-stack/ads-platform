'use server'

import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Verify a withdrawal PIN. Thin wrapper over verify_withdrawal_pin, which is
 * server-only and rate-limited (5 wrong tries → 15-minute lock). The user id
 * comes from the verified session, never the payload.
 *
 * The withdrawal itself is still demo (nothing is written; the real
 * request_redemption pipeline waits on PAYOUTS_ENABLED). But the PIN check is
 * real — you must enter your actual PIN, and repeated wrong tries lock you out.
 */
export type VerifyPinResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; retryAfter: string | null }
  | { ok: false; reason: 'no_pin' }
  | { ok: false; reason: 'error' }

export async function verifyWithdrawalPin(pin: string): Promise<VerifyPinResult> {
  if (!/^[0-9]{4}$/.test(pin)) return { ok: false, reason: 'error' }

  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'error' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('verify_withdrawal_pin', {
    p_user_id: user.id,
    p_pin: pin,
  })
  if (error || !data) return { ok: false, reason: 'error' }

  const v = data as {
    ok: boolean
    no_pin?: boolean
    locked?: boolean
    retry_after?: string
    attempts_left?: number
  }
  if (v.ok) return { ok: true }
  if (v.no_pin) return { ok: false, reason: 'no_pin' }
  if (v.locked) return { ok: false, reason: 'locked', retryAfter: v.retry_after ?? null }
  return { ok: false, reason: 'wrong', attemptsLeft: v.attempts_left ?? 0 }
}
