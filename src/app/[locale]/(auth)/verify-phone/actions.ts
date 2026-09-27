'use server'

import type { ActionResult, CodeSent } from '../actions'
import { landingFor } from '@/lib/auth/landing'
import { checkOtp, issueOtp } from '@/lib/auth/otp'
import { normalisePhone } from '@/lib/auth/phone'
import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'
import { phone as phoneSchema, smsCode } from '@/lib/validation/auth'

/**
 * Proving a phone for an account that is already signed in.
 *
 * This is where every account made before 2026-09-27 lands (the (app) layout
 * sends it here), and it is the only way `phone_verified_at` is ever set for
 * an existing account. The user always comes from the session, never from the
 * payload.
 */

async function ownerOf(phone: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id')
    .eq('phone', phone)
    .not('phone_verified_at', 'is', null)
    .maybeSingle()
  return data?.id ?? null
}

export async function sendPhoneCodeAction(input: { phone: string }): Promise<ActionResult | CodeSent> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'generic', redirectTo: '/login' }

  const parsed = phoneSchema.safeParse(input.phone)
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message, field: 'phone' }
  const phone = normalisePhone(parsed.data)

  const owner = await ownerOf(phone)
  if (owner && owner !== user.id) return { ok: false, errorKey: 'phoneTaken', field: 'phone' }

  const issued = await issueOtp({ purpose: 'verify_phone', phone, userId: user.id })
  if (!issued.ok) {
    if (issued.reason === 'smsFailed') return { ok: false, errorKey: 'smsFailed' }
    return {
      ok: false,
      errorKey: issued.reason === 'cooldown' ? 'codeCooldown' : 'codeLimit',
      retryAfter: issued.retryAfter,
    }
  }
  return { ok: true, codeSent: true, resendSeconds: issued.resendSeconds }
}

export async function confirmPhoneAction(input: { phone: string; code: string }): Promise<ActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'generic', redirectTo: '/login' }

  const parsed = phoneSchema.safeParse(input.phone)
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message, field: 'phone' }
  const code = smsCode.safeParse(input.code)
  if (!code.success) return { ok: false, errorKey: 'codeRequired', field: 'code' }
  const phone = normalisePhone(parsed.data)

  const checked = await checkOtp({ purpose: 'verify_phone', phone, userId: user.id, code: code.data })
  if (!checked.ok) {
    if (checked.reason === 'wrong') {
      return { ok: false, errorKey: 'codeInvalid', field: 'code', attemptsLeft: checked.attemptsLeft }
    }
    return { ok: false, errorKey: checked.reason === 'locked' ? 'codeLocked' : 'codeExpired', field: 'code' }
  }

  const { error } = await createAdminClient()
    .from('profiles')
    .update({ phone, phone_verified_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) {
    // Another account proved this number between the code going out and now.
    if (error.code === '23505') return { ok: false, errorKey: 'phoneTaken', field: 'phone' }
    reportUnexpected(error, 'verify-phone.mark-verified')
    return { ok: false, errorKey: 'generic' }
  }

  return { ok: true, redirectTo: await landingFor(user.id) }
}
