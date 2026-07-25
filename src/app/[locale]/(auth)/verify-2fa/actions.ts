'use server'

import { landingFor } from '@/lib/auth/landing'
import { getSessionUser } from '@/lib/auth/session'
import { clearLoginVerified, markLoginVerified } from '@/lib/security/login-2fa'
import { decryptSecret, normaliseBackupCode, verifyCode } from '@/lib/security/totp'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The sign-in challenge for enrolled accounts.
 *
 * The session already exists at this point — Supabase issues it on a correct
 * password — so this action does not authenticate, it ELEVATES: it decides
 * whether the half-authenticated session may be trusted by the app shell.
 *
 * A backup code is accepted here too. Losing a phone must not lock someone out
 * of a balance they earned, and the codes are single-use and rate limited on
 * the same counter as authenticator codes.
 */
export type ChallengeResult =
  | {
      ok: true
      usedBackupCode?: boolean
      backupCodesRemaining?: number
      /** Where to go now — /admin for an administrator. Decided on the server
       *  so the browser never has to know what a role is. */
      redirectTo: string
    }
  | { ok: false; errorKey: string; retryAfter?: string; attemptsLeft?: number }

export async function verifyLoginChallenge(input: {
  code: string
}): Promise<ChallengeResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const admin = createAdminClient()
  const entered = input.code.trim()

  const { data: lockData } = await admin.rpc('totp_lock_state', { p_user_id: user.id })
  const lock = (lockData ?? { locked: false }) as { locked: boolean; retry_after?: string }
  if (lock.locked) return { ok: false, errorKey: 'locked', retryAfter: lock.retry_after }

  // Six digits can only be an authenticator code; anything else can only be a
  // backup code, so an obvious typo never burns one.
  if (/^[0-9]{6}$/.test(entered)) {
    const { data: cipher } = await admin.rpc('get_totp_secret_cipher', { p_user_id: user.id })
    if (cipher && (await verifyCode(decryptSecret(cipher as string), entered))) {
      await admin.rpc('clear_totp_failures', { p_user_id: user.id })
      await markLoginVerified(user.id)
      return { ok: true, redirectTo: await landingFor(user.id) }
    }
    return registerFailure(user.id)
  }

  const { data } = await admin.rpc('consume_backup_code', {
    p_user_id: user.id,
    p_code: normaliseBackupCode(entered),
  })
  const result = (data ?? {}) as { ok?: boolean; remaining?: number }
  if (result.ok) {
    await admin.rpc('clear_totp_failures', { p_user_id: user.id })
    await markLoginVerified(user.id)
    return {
      ok: true,
      usedBackupCode: true,
      backupCodesRemaining: result.remaining ?? 0,
      redirectTo: await landingFor(user.id),
    }
  }
  return registerFailure(user.id)
}

/** Abandon a half-finished sign-in: drop the session rather than strand it. */
export async function cancelChallenge(): Promise<void> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  await supabase.auth.signOut()
  await clearLoginVerified()
}

async function registerFailure(userId: string): Promise<ChallengeResult> {
  const { data } = await createAdminClient().rpc('register_totp_failure', { p_user_id: userId })
  const state = (data ?? { locked: false }) as {
    locked: boolean
    retry_after?: string
    attempts_left?: number
  }
  if (state.locked) return { ok: false, errorKey: 'locked', retryAfter: state.retry_after }
  return { ok: false, errorKey: 'wrongCode', attemptsLeft: state.attempts_left }
}
