'use server'

import { createClient as createStatelessClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { checkOtp, issueOtp, notifyPhone } from '@/lib/auth/otp'
import { maskPhone, normalisePhone } from '@/lib/auth/phone'
import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { phone as phoneSchema, smsCode } from '@/lib/validation/auth'
import { isTwoFactorEnabled } from '@/lib/security/login-2fa'
import { decryptSecret, normaliseBackupCode, verifyCode } from '@/lib/security/totp'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Changing the two credentials that can move an account away from its owner:
 * the password and the sign-in phone (the email, until 2026-09-27).
 *
 * SINCE 2026-09-27 BOTH ALSO NEED AN SMS CODE (operator direction: "change of
 * passwords will all need OTP from sms"). A password change texts the verified
 * phone; a phone change texts the NEW number, which is what proves it is
 * theirs, and tells the old one it has been replaced.
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
  | { ok: true; smsSent?: true; resendSeconds?: number }
  | {
      ok: false
      errorKey?: string
      message?: string
      retryAfter?: string
      attemptsLeft?: number
      needsCode?: boolean
      /** The SMS code was the problem, not the password or authenticator. */
      smsField?: boolean
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

const changePhoneSchema = z.object({
  newPhone: phoneSchema,
  currentPassword: z.string().min(1, 'currentRequired'),
  code: z.string().optional(),
  smsCode: z.string().optional(),
})

export async function changePassword(input: {
  currentPassword: string
  newPassword: string
  confirmPassword: string
  code?: string
  /** Absent on the first press: the password and authenticator are checked
   *  and a code is texted. Present on the second: the change happens. */
  smsCode?: string
}): Promise<CredentialResult> {
  const parsed = changePasswordSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message }

  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  const password = await checkPassword(user.email, parsed.data.currentPassword)
  if (!password.ok) return password

  const stepUp = await checkStepUp(user.id, parsed.data.code)
  if (!stepUp.ok) return stepUp

  const phone = await verifiedPhoneOf(user.id)
  if (!phone) return { ok: false, errorKey: 'noVerifiedPhone' }

  if (!input.smsCode) return sendCode('change_password', phone, user.id)
  const sms = await checkSms('change_password', phone, user.id, input.smsCode)
  if (!sms.ok) return sms

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

/**
 * Move the sign-in to another phone number.
 *
 * Current password (and authenticator, when on) prove it is the owner; the
 * code texted to the NEW number proves the number is theirs. Without that a
 * typo would hand the sign-in to a stranger's phone. The old number is told,
 * so a change the owner did not make does not go unnoticed.
 */
export async function changePhone(input: {
  newPhone: string
  currentPassword: string
  code?: string
  smsCode?: string
}): Promise<CredentialResult> {
  const parsed = changePhoneSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message }

  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  const next = normalisePhone(parsed.data.newPhone)
  const current = await verifiedPhoneOf(user.id)
  if (next === current) return { ok: false, errorKey: 'samePhone' }

  const password = await checkPassword(user.email, parsed.data.currentPassword)
  if (!password.ok) return password

  const stepUp = await checkStepUp(user.id, parsed.data.code)
  if (!stepUp.ok) return stepUp

  const admin = createAdminClient()
  const { data: owner } = await admin.rpc('account_for_phone', { p_phone: next })
  if (owner?.[0] && owner[0].user_id !== user.id) return { ok: false, errorKey: 'phoneTaken' }

  if (!parsed.data.smsCode) return sendCode('change_phone', next, user.id)
  const sms = await checkSms('change_phone', next, user.id, parsed.data.smsCode)
  if (!sms.ok) return sms

  const { error } = await admin
    .from('profiles')
    .update({ phone: next, phone_verified_at: new Date().toISOString() })
    .eq('id', user.id)
  if (error) {
    if (error.code === '23505') return { ok: false, errorKey: 'phoneTaken' }
    reportUnexpected(error, 'credentials.change-phone')
    return { ok: false, errorKey: 'generic' }
  }

  if (current) {
    await notifyPhone(
      current,
      `Your SidePerks sign-in was moved from this number to ${maskPhone(next)}. If this was not you, contact SidePerks support now.`,
    )
  }
  return { ok: true }
}

/** Does this account have 2FA on? Drives whether the form asks for a code. */
export async function requiresCode(): Promise<boolean> {
  const user = await getSessionUser()
  if (!user) return false
  return isTwoFactorEnabled(user.id)
}

// -- internals --------------------------------------------------------------

/** The phone this account proved, or null (the layouts should prevent that). */
async function verifiedPhoneOf(userId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('phone, phone_verified_at')
    .eq('id', userId)
    .maybeSingle()
  return data?.phone_verified_at && data.phone ? data.phone : null
}

async function sendCode(
  purpose: 'change_password' | 'change_phone',
  phone: string,
  userId: string,
): Promise<CredentialResult> {
  const issued = await issueOtp({ purpose, phone, userId })
  if (issued.ok) return { ok: true, smsSent: true, resendSeconds: issued.resendSeconds }
  if (issued.reason === 'smsFailed') return { ok: false, errorKey: 'smsFailed' }
  return {
    ok: false,
    errorKey: issued.reason === 'cooldown' ? 'smsCooldown' : 'smsLimit',
    retryAfter: issued.retryAfter,
  }
}

async function checkSms(
  purpose: 'change_password' | 'change_phone',
  phone: string,
  userId: string,
  code: string,
): Promise<CredentialResult> {
  const parsed = smsCode.safeParse(code)
  if (!parsed.success) return { ok: false, errorKey: 'smsRequired', smsField: true }
  const checked = await checkOtp({ purpose, phone, userId, code: parsed.data })
  if (checked.ok) return { ok: true }
  if (checked.reason === 'wrong') {
    return { ok: false, errorKey: 'smsWrong', attemptsLeft: checked.attemptsLeft, smsField: true }
  }
  return { ok: false, errorKey: checked.reason === 'locked' ? 'smsLocked' : 'smsExpired', smsField: true }
}

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
