'use server'

import { createClient as createStatelessClient } from '@supabase/supabase-js'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import {
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  newSecret,
  normaliseBackupCode,
  otpauthUri,
  qrDataUri,
  verifyCode,
} from '@/lib/security/totp'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Two-factor server actions.
 *
 * Same trust model as the withdrawal PIN: every function in migration 031
 * except the secret-free status read is revoked from client roles, so these
 * run on the service-role client and take the user id from the verified
 * session — never from the payload. The plaintext secret exists only inside
 * this process, for the moment it takes to render a QR or check a code.
 */

export type TwoFactorResult =
  | { ok: true }
  | { ok: false; errorKey?: string; message?: string; retryAfter?: string; attemptsLeft?: number }

type LockState = { locked: boolean; retry_after?: string; attempts_left?: number }

/** The rejection half of a result, for helpers that can only ever fail. */
type TwoFactorFailure = Extract<TwoFactorResult, { ok: false }>

/**
 * Enrolment step 1 — mint a secret and hand back what the user needs to add
 * it to their authenticator.
 *
 * The secret is returned to the browser here, which is unavoidable: a QR code
 * IS the secret, and manual entry needs it in text. It is a one-time exposure
 * over TLS to the account owner, and the factor is worthless until step 2
 * proves they actually stored it.
 */
export async function beginEnrollment(): Promise<
  { ok: true; qr: string; secret: string } | { ok: false; errorKey?: string; message?: string }
> {
  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  try {
    const secret = newSecret()
    const admin = createAdminClient()
    const { error } = await admin.rpc('start_totp_enrollment', {
      p_user_id: user.id,
      p_cipher: encryptSecret(secret),
    })
    if (error) return { ok: false, message: error.message }

    const qr = await qrDataUri(otpauthUri(secret, user.email))
    return { ok: true, qr, secret }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Enrolment failed' }
  }
}

/**
 * Enrolment step 2 — prove possession, switch the factor on, and issue backup
 * codes in the same breath.
 *
 * The codes are generated here rather than on a later screen deliberately:
 * 2FA that is on with no way back in is how people lose accounts, and the
 * operator made backup codes mandatory for exactly that reason.
 */
export async function confirmEnrollment(
  code: string,
): Promise<
  | { ok: true; backupCodes: string[] }
  | { ok: false; errorKey?: string; message?: string; retryAfter?: string; attemptsLeft?: number }
> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const admin = createAdminClient()

  const lock = await readLock(user.id)
  if (lock.locked) return { ok: false, errorKey: 'locked', retryAfter: lock.retry_after }

  const { data: cipher } = await admin.rpc('get_totp_secret_cipher', { p_user_id: user.id })
  if (!cipher) return { ok: false, errorKey: 'noEnrollment' }

  const valid = await verifyCode(decryptSecret(cipher as string), code)
  if (!valid) return failure(user.id)

  const { error: confirmError } = await admin.rpc('confirm_totp_enrollment', {
    p_user_id: user.id,
  })
  if (confirmError) return { ok: false, message: confirmError.message }

  const codes = generateBackupCodes()
  const { error: codesError } = await admin.rpc('replace_backup_codes', {
    p_user_id: user.id,
    p_codes: codes.map(normaliseBackupCode),
  })
  if (codesError) return { ok: false, message: codesError.message }

  await admin.rpc('clear_totp_failures', { p_user_id: user.id })
  return { ok: true, backupCodes: codes }
}

/**
 * Issue a fresh set of codes, invalidating the old ones. Requires a live code
 * from the authenticator: whoever asks must hold the factor, otherwise a
 * borrowed session could quietly mint itself a permanent way back in.
 */
export async function regenerateBackupCodes(
  code: string,
): Promise<
  | { ok: true; backupCodes: string[] }
  | { ok: false; errorKey?: string; message?: string; retryAfter?: string; attemptsLeft?: number }
> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const check = await verifyOwnCode(user.id, code)
  if (!check.ok) return check

  const admin = createAdminClient()
  const codes = generateBackupCodes()
  const { error } = await admin.rpc('replace_backup_codes', {
    p_user_id: user.id,
    p_codes: codes.map(normaliseBackupCode),
  })
  if (error) return { ok: false, message: error.message }

  return { ok: true, backupCodes: codes }
}

/**
 * Turn 2FA off. Accepts either a current code or the account password — a
 * user whose phone is lost still has to be able to switch the factor off, and
 * their password is the credential they demonstrably still hold. The password
 * is checked on a throwaway client so the live session is untouched (same
 * technique as the PIN reset).
 */
export async function disableTwoFactor(input: {
  code?: string
  password?: string
}): Promise<TwoFactorResult> {
  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  if (input.code) {
    const check = await verifyOwnCode(user.id, input.code)
    if (!check.ok) return check
  } else if (input.password) {
    const stateless = createStatelessClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { error } = await stateless.auth.signInWithPassword({
      email: user.email,
      password: input.password,
    })
    if (error) return { ok: false, errorKey: 'wrongPassword' }
  } else {
    return { ok: false, errorKey: 'stepUpRequired' }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('disable_totp', { p_user_id: user.id })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

/** Abandon a half-finished enrolment (secret stored, never confirmed). */
export async function cancelEnrollment(): Promise<TwoFactorResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('disable_totp', { p_user_id: user.id })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

/**
 * Step-up verification for use by other sensitive flows (password change,
 * email change, PIN reset). Accepts a live authenticator code OR an unused
 * backup code, so a lost phone is never a dead end.
 */
export async function verifyStepUp(input: {
  code: string
}): Promise<TwoFactorResult & { usedBackupCode?: boolean; backupCodesRemaining?: number }> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const admin = createAdminClient()
  const lock = await readLock(user.id)
  if (lock.locked) return { ok: false, errorKey: 'locked', retryAfter: lock.retry_after }

  // A 6-digit string is an authenticator code; anything else can only be a
  // backup code, so we do not burn one on an obvious typo.
  if (/^[0-9]{6}$/.test(input.code.trim())) {
    const { data: cipher } = await admin.rpc('get_totp_secret_cipher', { p_user_id: user.id })
    if (cipher && (await verifyCode(decryptSecret(cipher as string), input.code.trim()))) {
      await admin.rpc('clear_totp_failures', { p_user_id: user.id })
      return { ok: true }
    }
    return failure(user.id)
  }

  const { data } = await admin.rpc('consume_backup_code', {
    p_user_id: user.id,
    p_code: normaliseBackupCode(input.code),
  })
  const result = (data ?? {}) as { ok?: boolean; remaining?: number }
  if (result.ok) {
    await admin.rpc('clear_totp_failures', { p_user_id: user.id })
    return { ok: true, usedBackupCode: true, backupCodesRemaining: result.remaining ?? 0 }
  }
  return failure(user.id)
}

// -- internals --------------------------------------------------------------

async function readLock(userId: string): Promise<LockState> {
  const admin = createAdminClient()
  const { data } = await admin.rpc('totp_lock_state', { p_user_id: userId })
  return (data ?? { locked: false }) as LockState
}

/** Count a wrong code and translate the resulting state for the UI. */
async function failure(userId: string): Promise<TwoFactorFailure> {
  const admin = createAdminClient()
  const { data } = await admin.rpc('register_totp_failure', { p_user_id: userId })
  const state = (data ?? { locked: false }) as LockState
  if (state.locked) return { ok: false, errorKey: 'locked', retryAfter: state.retry_after }
  return { ok: false, errorKey: 'wrongCode', attemptsLeft: state.attempts_left }
}

/** Verify a live authenticator code for an already-enabled factor. */
async function verifyOwnCode(userId: string, code: string): Promise<TwoFactorResult> {
  const admin = createAdminClient()

  const lock = await readLock(userId)
  if (lock.locked) return { ok: false, errorKey: 'locked', retryAfter: lock.retry_after }

  const { data: cipher } = await admin.rpc('get_totp_secret_cipher', { p_user_id: userId })
  if (!cipher) return { ok: false, errorKey: 'notEnabled' }

  if (!(await verifyCode(decryptSecret(cipher as string), code))) return failure(userId)

  await admin.rpc('clear_totp_failures', { p_user_id: userId })
  return { ok: true }
}
