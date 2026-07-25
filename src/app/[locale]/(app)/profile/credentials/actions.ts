'use server'

import { createClient as createStatelessClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { isTwoFactorEnabled } from '@/lib/security/login-2fa'
import { decryptSecret, normaliseBackupCode, verifyCode } from '@/lib/security/totp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrigin } from '@/lib/request-context'
import { createClient } from '@/lib/supabase/server'

/**
 * Changing the two credentials that can move an account away from its owner:
 * the password and the email address.
 *
 * Both demand proof of identity beyond holding the session, because a session
 * is exactly what an attacker on an unlocked phone already has. The proof is
 * the current password AND, when 2FA is on, a code from the authenticator —
 * operator direction 2026-07-25: the authenticator, never an emailed code.
 *
 * (The confirmation Supabase sends to a NEW address is a different thing and
 * is kept: it proves the new inbox exists and belongs to the user. Without it
 * a typo would hand the account to a stranger, or to nobody at all.)
 */
export type CredentialResult =
  | { ok: true; emailConfirmationSent?: boolean }
  | {
      ok: false
      errorKey?: string
      message?: string
      retryAfter?: string
      attemptsLeft?: number
      needsCode?: boolean
    }

const passwordRules = z
  .string()
  .min(8, 'passwordTooWeak')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'passwordTooWeak')

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'currentRequired'),
    newPassword: passwordRules,
    confirmPassword: z.string().min(1, 'confirmRequired'),
    code: z.string().optional(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'sameAsCurrent',
    path: ['newPassword'],
  })

const changeEmailSchema = z.object({
  newEmail: z.email('emailInvalid'),
  currentPassword: z.string().min(1, 'currentRequired'),
  code: z.string().optional(),
})

export async function changePassword(input: {
  currentPassword: string
  newPassword: string
  confirmPassword: string
  code?: string
}): Promise<CredentialResult> {
  const parsed = changePasswordSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message }

  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  const password = await checkPassword(user.email, parsed.data.currentPassword)
  if (!password.ok) return password

  const stepUp = await checkStepUp(user.id, parsed.data.code)
  if (!stepUp.ok) return stepUp

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword })
  if (error) {
    if (/different from the old/i.test(error.message)) {
      return { ok: false, errorKey: 'sameAsCurrent' }
    }
    return { ok: false, message: error.message }
  }
  return { ok: true }
}

export async function changeEmail(input: {
  newEmail: string
  currentPassword: string
  code?: string
}): Promise<CredentialResult> {
  const parsed = changeEmailSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message }

  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  const next = parsed.data.newEmail.trim().toLowerCase()
  if (next === user.email.toLowerCase()) return { ok: false, errorKey: 'sameEmail' }

  const password = await checkPassword(user.email, parsed.data.currentPassword)
  if (!password.ok) return password

  const stepUp = await checkStepUp(user.id, parsed.data.code)
  if (!stepUp.ok) return stepUp

  const supabase = await createClient()
  const origin = await getOrigin()
  /*
    The NEW address gets a link, and it has to come back to us — without
    emailRedirectTo it lands on the project's Site URL, which is a single
    fixed value and still points at localhost. `next` sends them to Profile,
    where the address they just proved is now the one shown.
  */
  const { error } = await supabase.auth.updateUser(
    { email: next },
    { emailRedirectTo: `${origin}/auth/confirm?next=/profile` },
  )
  if (error) {
    // Supabase reports an address already in use; do not confirm it exists.
    if (/already/i.test(error.message)) return { ok: false, errorKey: 'emailTaken' }
    return { ok: false, message: error.message }
  }
  return { ok: true, emailConfirmationSent: true }
}

/** Does this account have 2FA on? Drives whether the form asks for a code. */
export async function requiresCode(): Promise<boolean> {
  const user = await getSessionUser()
  if (!user) return false
  return isTwoFactorEnabled(user.id)
}

// -- internals --------------------------------------------------------------

/**
 * Re-checks the password on a throwaway client, so verifying identity never
 * disturbs the session the user is currently using.
 */
async function checkPassword(email: string, password: string): Promise<CredentialResult> {
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
 * Second factor, when the account has one. Accepts an authenticator code or an
 * unused backup code, and shares the 5-tries/15-minute counter, so this cannot
 * be used as an unlimited oracle against the same secret.
 */
async function checkStepUp(userId: string, code?: string): Promise<CredentialResult> {
  if (!(await isTwoFactorEnabled(userId))) return { ok: true }

  const entered = code?.trim()
  if (!entered) return { ok: false, errorKey: 'codeRequired', needsCode: true }

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
  return { ok: false, errorKey: 'wrongCode', attemptsLeft: state.attempts_left, needsCode: true }
}
