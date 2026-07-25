'use server'

import { createClient as createStatelessClient } from '@supabase/supabase-js'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { clearLoginVerified, isTwoFactorEnabled } from '@/lib/security/login-2fa'
import { decryptSecret, normaliseBackupCode, verifyCode } from '@/lib/security/totp'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Account deletion — requested here, carried out 15 days later.
 *
 * Three gates, in the operator's order: the password, an authenticator code,
 * and typing the phrase. The first two prove who is asking; the phrase proves
 * they meant it. Every gate is re-checked at the final submit, because the
 * earlier steps are UI state and UI state is not a boundary (§2.4).
 */
export type DeleteResult =
  | { ok: true; effectiveAt: string }
  | {
      ok: false
      errorKey?: string
      message?: string
      retryAfter?: string
      attemptsLeft?: number
    }

export type CheckResult =
  | { ok: true }
  | { ok: false; errorKey?: string; message?: string; retryAfter?: string; attemptsLeft?: number }

/** Exactly the phrase the operator specified. */
const PHRASE = 'delete my account'

/** Step 1 — the password, checked without disturbing the live session. */
export async function checkDeletionPassword(password: string): Promise<CheckResult> {
  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }
  return verifyPassword(user.email, password)
}

/** Step 2 — an authenticator code (or a backup code). */
export async function checkDeletionCode(code: string): Promise<CheckResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }
  return verifySecondFactor(user.id, code)
}

/** Does this account even have a second factor to ask for? */
export async function deletionNeedsCode(): Promise<boolean> {
  const user = await getSessionUser()
  if (!user) return false
  return isTwoFactorEnabled(user.id)
}

/**
 * Final submit. Re-runs every check, schedules the deletion, then signs the
 * user out — signing back in is what cancels, so leaving them signed in would
 * cancel the request they just made.
 */
export async function confirmAccountDeletion(input: {
  password: string
  code?: string
  phrase: string
}): Promise<DeleteResult> {
  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  /*
    Case-insensitive on purpose. Mobile keyboards capitalise the first letter
    by default, so an exact-case comparison would reject "Delete my account"
    from someone who typed precisely what was asked. Wording is still required
    in full.
  */
  if (input.phrase.trim().replace(/\s+/g, ' ').toLowerCase() !== PHRASE) {
    return { ok: false, errorKey: 'phraseMismatch' }
  }

  const password = await verifyPassword(user.email, input.password)
  if (!password.ok) return password

  const factor = await verifySecondFactor(user.id, input.code)
  if (!factor.ok) return factor

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('request_account_deletion', { p_user_id: user.id })
  if (error) return { ok: false, message: error.message }

  const effectiveAt = String(data)

  // Best effort: the record of the request matters, telling them about it is
  // a courtesy that must not fail the request.
  try {
    await admin.rpc('create_notification', {
      p_user_id: user.id,
      p_type: 'announcement',
      p_title: 'Account deletion scheduled',
      p_body:
        'Your account is scheduled for deletion. Sign in again before it completes and the request is cancelled automatically.',
      p_reference: { deletion_effective_at: effectiveAt },
    })
  } catch {
    // ignored
  }

  const supabase = await createClient()
  await supabase.auth.signOut()
  await clearLoginVerified()

  return { ok: true, effectiveAt }
}

// -- internals --------------------------------------------------------------

async function verifyPassword(email: string, password: string): Promise<CheckResult> {
  if (!password) return { ok: false, errorKey: 'passwordRequired' }
  const stateless = createStatelessClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error } = await stateless.auth.signInWithPassword({ email, password })
  if (error) return { ok: false, errorKey: 'wrongPassword' }
  return { ok: true }
}

/**
 * The second factor, when the account has one. Shares the 5-tries/15-minute
 * counter with every other code check, so this screen cannot be used as an
 * unlimited oracle against the same secret.
 */
async function verifySecondFactor(userId: string, code?: string): Promise<CheckResult> {
  if (!(await isTwoFactorEnabled(userId))) return { ok: true }

  const entered = code?.trim()
  if (!entered) return { ok: false, errorKey: 'codeRequired' }

  const admin = createAdminClient()
  const { data: lockData } = await admin.rpc('totp_lock_state', { p_user_id: userId })
  const lock = (lockData ?? { locked: false }) as { locked: boolean; retry_after?: string }
  if (lock.locked) return { ok: false, errorKey: 'locked', retryAfter: lock.retry_after }

  if (/^[0-9]{6}$/.test(entered)) {
    const { data: cipher } = await admin.rpc('get_totp_secret_cipher', { p_user_id: userId })
    if (cipher && (await verifyCode(decryptSecret(cipher as string), entered))) {
      await admin.rpc('clear_totp_failures', { p_user_id: userId })
      return { ok: true }
    }
  } else {
    const { data } = await admin.rpc('consume_backup_code', {
      p_user_id: userId,
      p_code: normaliseBackupCode(entered),
    })
    if ((data as { ok?: boolean } | null)?.ok) {
      await admin.rpc('clear_totp_failures', { p_user_id: userId })
      return { ok: true }
    }
  }

  const { data } = await admin.rpc('register_totp_failure', { p_user_id: userId })
  const state = (data ?? { locked: false }) as {
    locked: boolean
    retry_after?: string
    attempts_left?: number
  }
  if (state.locked) return { ok: false, errorKey: 'locked', retryAfter: state.retry_after }
  return { ok: false, errorKey: 'wrongCode', attemptsLeft: state.attempts_left }
}

/** Cancel from inside the app, for someone who changed their mind early. */
export async function cancelDeletionRequest(): Promise<{ ok: boolean }> {
  const user = await getSessionUser()
  if (!user) return { ok: false }
  const { error } = await createAdminClient().rpc('cancel_account_deletion', {
    p_user_id: user.id,
  })
  return { ok: !error }
}
