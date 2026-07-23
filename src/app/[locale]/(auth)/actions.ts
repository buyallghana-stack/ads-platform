'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getRequestContext } from '@/lib/request-context'
import {
  forgotPasswordSchema,
  logInSchema,
  signUpSchema,
  verifyCodeSchema,
} from '@/lib/validation/auth'

/**
 * Auth server actions.
 *
 * Everything that decides anything runs here, not in the browser. The client
 * schemas are the same ones, but they are convenience — a form can be
 * bypassed, so these are the boundary (§2.4).
 *
 * Returned errors are translation KEYS, resolved by the caller against the
 * active locale, so no user-facing string is hardcoded on the server (§3).
 */

export type ActionResult =
  | { ok: true; redirectTo?: string }
  | { ok: false; errorKey: string; message?: string; field?: string }

/** A raw message from a check that already produced human copy. */
const literal = (message: string): ActionResult => ({ ok: false, errorKey: '', message })

export async function signUpAction(formData: {
  fullName: string
  email: string
  phone: string
  password: string
  referralCode?: string
  acceptTerms: boolean
}): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(formData)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, errorKey: first.message, field: String(first.path[0] ?? '') }
  }
  const data = parsed.data

  const { ip, userAgent, country } = await getRequestContext()
  const admin = createAdminClient()

  /*
    Blocking fraud checks run BEFORE the account exists. Otherwise every
    blocked attempt leaves an orphaned auth user behind and the person is told
    their account was created and then that they are blocked.
  */
  const { data: precheck, error: precheckError } = await admin.rpc('precheck_signup_fraud', {
    p_email: data.email,
    p_ip: ip ?? undefined,
  })
  if (precheckError) return { ok: false, errorKey: 'generic' }
  if (precheck && precheck.allowed === false) {
    return literal(precheck.block_reason ?? 'Signup is not available.')
  }

  // Supabase deliberately returns a vague error for an existing email. On our
  // own signup form the honest message is better — see the note in migration
  // 023 on why this is acceptable here and not on password reset.
  const { data: taken } = await admin.rpc('email_is_registered', { p_email: data.email })
  if (taken) return { ok: false, errorKey: 'emailTaken', field: 'email' }

  /*
    Referral code validated before the account is created. Creating a user and
    then failing on a mistyped code would leave them with an account and no
    referral, and no obvious way to fix it.
  */
  let referrerId: string | null = null
  if (data.referralCode) {
    const { data: referrer } = await admin
      .from('profiles')
      .select('id, disabled_at')
      .eq('referral_code', data.referralCode)
      .maybeSingle()

    if (!referrer || referrer.disabled_at) {
      return { ok: false, errorKey: 'referralNotFound', field: 'referralCode' }
    }
    referrerId = referrer.id
  }

  const supabase = await createClient()
  const { data: signUp, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      // Read by the handle_new_user trigger (migration 001) to populate the
      // profile in the same transaction as the auth user.
      data: {
        full_name: data.fullName,
        phone: data.phone,
        signup_country: country ?? 'GH',
      },
    },
  })

  if (signUpError || !signUp.user) {
    return { ok: false, errorKey: 'generic', message: signUpError?.message }
  }

  const userId = signUp.user.id

  /*
    Everything below is best-effort. The account exists and the user is
    waiting; failing their signup because a fraud signal could not be recorded
    would be the wrong trade. Failures are swallowed deliberately and the
    account still lands in the review queue on its next signal.
  */
  try {
    await admin.rpc('record_auth_signal', {
      p_user_id: userId,
      p_event_type: 'signup',
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
      p_country: country ?? undefined,
    })

    await admin.rpc('evaluate_signup_fraud', {
      p_user_id: userId,
      p_email: data.email,
      p_phone: data.phone,
      p_ip: ip ?? undefined,
      p_fingerprint: undefined, // ThumbmarkJS lands with the fraud client work
    })

    if (referrerId && data.referralCode) {
      await admin.rpc('apply_referral_code', {
        p_referee_id: userId,
        p_code: data.referralCode,
        p_ip: ip ?? undefined,
        p_fingerprint: undefined,
      })
    }
  } catch {
    // Intentionally ignored — see above.
  }

  /*
    Where to send them depends on the project's "Confirm email" setting, which
    is Supabase config rather than something this code controls:

      confirmation ON  — signUp returns no session, an email goes out, and the
                         account cannot earn until verified (§6.1).
      confirmation OFF — signUp returns a session immediately and /verify would
                         be a dead end asking for a code that was never sent.

    Reading the returned session rather than assuming means flipping that
    setting never breaks the flow, in either direction.
  */
  const isConfirmed = Boolean(signUp.session)

  return {
    ok: true,
    redirectTo: isConfirmed
      ? '/dashboard'
      : `/verify?email=${encodeURIComponent(data.email)}`,
  }
}

export async function logInAction(formData: {
  email: string
  password: string
}): Promise<ActionResult> {
  const parsed = logInSchema.safeParse(formData)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, errorKey: first.message, field: String(first.path[0] ?? '') }
  }

  const supabase = await createClient()
  const { data: session, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    /*
      One message for both "no such account" and "wrong password". Telling
      them apart hands an attacker a way to enumerate registered emails, which
      on a platform that pays out money is exactly the list worth phishing.
    */
    if (error.message.toLowerCase().includes('not confirmed')) {
      return {
        ok: false,
        errorKey: 'emailNotVerified',
        redirectTo: `/verify?email=${encodeURIComponent(parsed.data.email)}`,
      } as ActionResult
    }
    return { ok: false, errorKey: 'invalidCredentials' }
  }

  if (session.user) {
    const { ip, userAgent, country } = await getRequestContext()
    try {
      await createAdminClient().rpc('record_auth_signal', {
        p_user_id: session.user.id,
        p_event_type: 'login',
        p_ip: ip ?? undefined,
        p_user_agent: userAgent ?? undefined,
        p_country: country ?? undefined,
      })
    } catch {
      // A missing login signal must never block a login.
    }
  }

  return { ok: true, redirectTo: '/dashboard' }
}

export async function verifyCodeAction(formData: {
  email: string
  code: string
}): Promise<ActionResult> {
  const parsed = verifyCodeSchema.safeParse({ code: formData.code })
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    email: formData.email,
    token: parsed.data.code,
    type: 'signup',
  })

  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes('expired')) return { ok: false, errorKey: 'codeExpired' }
    return { ok: false, errorKey: 'codeInvalid' }
  }

  return { ok: true, redirectTo: '/dashboard' }
}

export async function resendCodeAction(email: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error) return { ok: false, errorKey: 'generic', message: error.message }
  return { ok: true }
}

export async function forgotPasswordAction(formData: { email: string }): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, errorKey: parsed.error.issues[0].message, field: 'email' }
  }

  const supabase = await createClient()
  /*
    The result is deliberately ignored. Reporting whether the address exists
    would turn this form into a membership oracle, and unlike signup there is
    no action the person could take to learn the same fact. Always reports
    success; the copy says "if an account exists".
  */
  await supabase.auth.resetPasswordForEmail(parsed.data.email)
  return { ok: true }
}

export async function logOutAction(): Promise<ActionResult> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return { ok: true, redirectTo: '/login' }
}
