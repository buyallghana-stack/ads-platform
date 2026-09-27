'use server'

import { createClient as createStatelessClient } from '@supabase/supabase-js'

import { clearLoginVerified, isTwoFactorEnabled } from '@/lib/security/login-2fa'
import { recordSessionContext } from '@/lib/security/session-record'
import { verifyTurnstile } from '@/lib/fraud/turnstile'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { clientEnv } from '@/lib/env'
import { landingFor } from '@/lib/auth/landing'
import { checkOtp, issueOtp, type OtpCheckResult, type OtpIssueResult } from '@/lib/auth/otp'
import { normalisePhone, syntheticEmail } from '@/lib/auth/phone'
import { getOrigin, getRequestContext } from '@/lib/request-context'
import {
  forgotPasswordEmailSchema,
  forgotPasswordSchema,
  legacyLogInSchema,
  logInSchema,
  resetPasswordSchema,
  signUpSchema,
  smsCode,
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
  | {
      ok: true
      redirectTo?: string
      deletionPending?: boolean
      requestedAt?: string
      effectiveAt?: string
    }
  | {
      ok: false
      errorKey: string
      message?: string
      field?: string
      redirectTo?: string
      /** When another code may be asked for (cooldown and hourly cap). */
      retryAfter?: string
      /** Tries left on the current code. */
      attemptsLeft?: number
    }

/** Returned when a code went out; the screen starts its resend countdown. */
export type CodeSent = { ok: true; codeSent: true; resendSeconds: number }

/** A raw message from a check that already produced human copy. */
const literal = (message: string): ActionResult => ({ ok: false, errorKey: '', message })

/** The two OTP outcomes, as the translation keys every code screen shares. */
function issueError(r: Exclude<OtpIssueResult, { ok: true }>): ActionResult {
  if (r.reason === 'smsFailed') return { ok: false, errorKey: 'smsFailed' }
  return {
    ok: false,
    errorKey: r.reason === 'cooldown' ? 'codeCooldown' : 'codeLimit',
    retryAfter: r.retryAfter,
  }
}

function checkError(r: Exclude<OtpCheckResult, { ok: true }>): ActionResult {
  if (r.reason === 'wrong') {
    return { ok: false, errorKey: 'codeInvalid', field: 'code', attemptsLeft: r.attemptsLeft }
  }
  return { ok: false, errorKey: r.reason === 'locked' ? 'codeLocked' : 'codeExpired', field: 'code' }
}

/** The account a verified phone signs in to, or null. */
async function accountForPhone(phone: string) {
  const { data } = await createAdminClient().rpc('account_for_phone', { p_phone: phone })
  return data?.[0] ?? null
}

type SignUpFields = {
  fullName: string
  phone: string
  password: string
  referralCode?: string
  acceptTerms: boolean
  /** Device fingerprint from the browser. Optional; see signUpSchema. */
  fingerprint?: string
  /** Turnstile token. Only checked when the operator has set keys. */
  turnstileToken?: string
}

/**
 * Everything that must be true before a number is sent a signup code, and
 * again before the account is made. Returns the parsed form and the referrer.
 */
async function vetSignUp(
  formData: SignUpFields,
  opts: { botCheck: boolean },
): Promise<
  | { ok: true; data: ReturnType<typeof signUpSchema.parse>; phone: string; referrerId: string | null }
  | { ok: false; result: ActionResult }
> {
  const parsed = signUpSchema.safeParse(formData)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, result: { ok: false, errorKey: first.message, field: String(first.path[0] ?? '') } }
  }
  const data = parsed.data
  const phone = normalisePhone(data.phone)

  const { ip } = await getRequestContext()
  const admin = createAdminClient()

  /*
    The bot check goes FIRST, before any database work and before an SMS goes
    anywhere. It matters more now than it did for email: every code costs
    money, and a form that texts any number it is given is what SMS-pumping
    fraud looks for. Only on the step that sends a code; the second step is
    already gated by the code itself.
  */
  if (opts.botCheck) {
    const bot = await verifyTurnstile(data.turnstileToken)
    if (!bot.ok) {
      // Codes only, never the token. See the note in git history (2026-07-29).
      console.error('[turnstile] refused:', bot.reason)
      /* NO `field`: the bot check is not an input, and a field-tagged error
         sent the message to a control that does not exist. */
      return { ok: false, result: { ok: false, errorKey: bot.retry ? 'botCheckRetry' : 'botCheckFailed' } }
    }
  }

  /* Blocking fraud checks run BEFORE the account exists, so a blocked attempt
     leaves nothing behind. The email checks inside see a generated address on
     our own domain and stay quiet; the IP checks are what speak. */
  const { data: precheck, error: precheckError } = await admin.rpc('precheck_signup_fraud', {
    p_email: 'signup@members.sideperks.org',
    p_ip: ip ?? undefined,
  })
  if (precheckError) return { ok: false, result: { ok: false, errorKey: 'generic' } }
  if (precheck && precheck.allowed === false) {
    return { ok: false, result: literal(precheck.block_reason ?? 'Signup is not available.') }
  }

  // One account per verified number. Saying so on our own signup form is the
  // honest message, as it was for email (see migration 023).
  if (await accountForPhone(phone)) {
    return { ok: false, result: { ok: false, errorKey: 'phoneTaken', field: 'phone' } }
  }

  /* A deleted account's phone may never come back (operator spec
     2026-07-25). Checked against hashes, and the message stays generic. */
  const { data: blocked } = await admin.rpc('is_identity_blocked', { p_email: '', p_phone: phone })
  if (blocked) return { ok: false, result: { ok: false, errorKey: 'identityBlocked', field: 'phone' } }

  /* Referral code validated before the account is created: failing on a
     mistyped code after the fact would leave an account with no referral. */
  let referrerId: string | null = null
  if (data.referralCode) {
    const { data: referrer } = await admin
      .from('profiles')
      .select('id, disabled_at')
      .eq('referral_code', data.referralCode)
      .maybeSingle()

    if (!referrer || referrer.disabled_at) {
      return { ok: false, result: { ok: false, errorKey: 'referralNotFound', field: 'referralCode' } }
    }
    referrerId = referrer.id
  }

  return { ok: true, data, phone, referrerId }
}

/**
 * Signup, step 1: check the form and text a code to the number.
 *
 * The account is NOT made yet. Making it first and verifying after would let
 * anybody park an unproved account on somebody else's number. Calling this
 * again is how "send another code" works, with a fresh bot-check token.
 */
export async function startSignUpAction(formData: SignUpFields): Promise<ActionResult | CodeSent> {
  const vetted = await vetSignUp(formData, { botCheck: true })
  if (!vetted.ok) return vetted.result

  const issued = await issueOtp({ purpose: 'signup', phone: vetted.phone })
  if (!issued.ok) return issueError(issued)
  return { ok: true, codeSent: true, resendSeconds: issued.resendSeconds }
}

/**
 * Signup, step 2: the code proves the number, and the account is made.
 *
 * The password arrives again with the code rather than being held on the
 * server between steps. It never touches a table of ours.
 */
export async function completeSignUpAction(
  formData: SignUpFields & { code: string },
): Promise<ActionResult> {
  const code = smsCode.safeParse(formData.code)
  if (!code.success) return { ok: false, errorKey: 'codeRequired', field: 'code' }

  const vetted = await vetSignUp(formData, { botCheck: false })
  if (!vetted.ok) return vetted.result
  const { data, phone, referrerId } = vetted

  const checked = await checkOtp({ purpose: 'signup', phone, code: code.data })
  if (!checked.ok) return checkError(checked)

  const { ip, userAgent, country } = await getRequestContext()
  const admin = createAdminClient()
  const email = syntheticEmail()

  /*
    Made by the admin API, confirmed, because there is no inbox to confirm:
    the SMS code above was the verification. The metadata is read by
    `handle_new_user` (migration 001), which writes the profile in the same
    transaction as the auth user.
  */
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: data.password,
    email_confirm: true,
    user_metadata: {
      full_name: data.fullName,
      phone,
      signup_country: country ?? 'GH',
    },
  })

  if (createError || !created.user) {
    if (createError?.code === 'weak_password') {
      return { ok: false, errorKey: 'passwordTooWeak', field: 'password' }
    }
    reportUnexpected(createError, 'signup.create-user')
    return { ok: false, errorKey: 'generic' }
  }

  const userId = created.user.id

  /* The proof, recorded. The partial unique index settles a race between two
     signups that proved the same number in the same second: the loser's
     account is removed rather than left holding an unverified duplicate. */
  const { error: verifyError } = await admin
    .from('profiles')
    .update({ phone, phone_verified_at: new Date().toISOString() })
    .eq('id', userId)
  if (verifyError) {
    await admin.auth.admin.deleteUser(userId)
    if (verifyError.code === '23505') return { ok: false, errorKey: 'phoneTaken', field: 'phone' }
    reportUnexpected(verifyError, 'signup.mark-phone-verified')
    return { ok: false, errorKey: 'generic' }
  }

  const supabase = await createClient()
  const { data: signedIn } = await supabase.auth.signInWithPassword({ email, password: data.password })
  await recordSessionContext(signedIn.session?.access_token, userId)

  /*
    Everything below is best-effort. The account exists and the person is
    waiting; no fraud signal is worth failing a signup over. Still reported,
    so the fraud layer cannot look calm while seeing nothing.
  */
  try {
    await admin.rpc('record_auth_signal', {
      p_user_id: userId,
      p_event_type: 'signup',
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
      p_country: country ?? undefined,
      p_fingerprint: data.fingerprint || undefined,
    })

    await admin.rpc('evaluate_signup_fraud', {
      p_user_id: userId,
      p_email: email,
      p_phone: phone,
      p_ip: ip ?? undefined,
      // `device_multi_account` (30) and `self_referral_suspected` (35) need this.
      p_fingerprint: data.fingerprint || undefined,
    })

    if (referrerId && data.referralCode) {
      await admin.rpc('apply_referral_code', {
        p_referee_id: userId,
        p_code: data.referralCode,
        p_ip: ip ?? undefined,
        p_fingerprint: data.fingerprint || undefined,
      })
    }
  } catch (error) {
    reportUnexpected(error, 'signup.fraud-signals')
  }

  return { ok: true, redirectTo: signedIn.session ? '/dashboard' : '/login' }
}

/**
 * Sign in with a phone number and password.
 *
 * The phone is resolved to the account's email identity and the rest is the
 * ordinary password sign-in. An unknown number and a wrong password get the
 * same answer, so this is not a way to test which numbers have accounts.
 */
export async function logInAction(formData: {
  phone: string
  password: string
  /** Device fingerprint from the browser. Optional; see signUpSchema. */
  fingerprint?: string
}): Promise<ActionResult> {
  const parsed = logInSchema.safeParse(formData)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, errorKey: first.message, field: String(first.path[0] ?? '') }
  }

  const account = await accountForPhone(normalisePhone(parsed.data.phone))
  if (!account) return { ok: false, errorKey: 'invalidCredentials' }

  return signInWithPassword(
    { email: account.email, password: parsed.data.password, fingerprint: parsed.data.fingerprint },
    { legacy: false },
  )
}

/**
 * Sign in with an email, for accounts made before phone sign-in.
 *
 * Only while the account has not proved a phone. Once it has, the email route
 * is closed for it (operator direction 2026-09-27: email is deprecated for
 * auth), and the refusal comes AFTER the password check, so it tells nothing
 * to somebody who does not already know the password.
 */
export async function legacyLogInAction(formData: {
  email: string
  password: string
  fingerprint?: string
}): Promise<ActionResult> {
  const parsed = legacyLogInSchema.safeParse(formData)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, errorKey: first.message, field: String(first.path[0] ?? '') }
  }
  return signInWithPassword(parsed.data, { legacy: true })
}

async function signInWithPassword(
  parsed: { email: string; password: string; fingerprint?: string },
  opts: { legacy: boolean },
): Promise<ActionResult> {

  // First, verify credentials with a stateless client WITHOUT creating any session cookies yet.
  const stateless = createStatelessClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data: authData, error: authError } = await stateless.auth.signInWithPassword({
    email: parsed.email,
    password: parsed.password,
  })

  if (authError || !authData.user) {
    return { ok: false, errorKey: opts.legacy ? 'invalidEmailCredentials' : 'invalidCredentials' }
  }

  // Check if account deletion has been requested and is currently pending.
  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('deletion_requested_at, deletion_effective_at, deleted_at, phone_verified_at')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (opts.legacy && profile?.phone_verified_at) {
    return { ok: false, errorKey: 'usePhoneToSignIn' }
  }

  if (profile?.deletion_requested_at && !profile.deleted_at) {
    // Return deletion pending metadata. NO session cookie is set on the browser,
    // so the user cannot enter the app without making an explicit choice.
    return {
      ok: true,
      deletionPending: true,
      requestedAt: profile.deletion_requested_at,
      effectiveAt: profile.deletion_effective_at ?? undefined,
    }
  }

  // Account does not have pending deletion: establish full session with cookies.
  const supabase = await createClient()
  const { data: session, error } = await supabase.auth.signInWithPassword({
    email: parsed.email,
    password: parsed.password,
  })

  if (error || !session.user) {
    return { ok: false, errorKey: 'invalidCredentials' }
  }

  await clearLoginVerified()

  if (session.user) {
    await recordSessionContext(session.session?.access_token, session.user.id)

    const { ip, userAgent, country } = await getRequestContext()
    try {
      await createAdminClient().rpc('record_auth_signal', {
        p_user_id: session.user.id,
        p_event_type: 'login',
        p_ip: ip ?? undefined,
        p_user_agent: userAgent ?? undefined,
        p_country: country ?? undefined,
        p_fingerprint: parsed.fingerprint || undefined,
      })
    } catch {
      // A missing login signal must never block a login.
    }

    // Enrolled accounts finish signing in on the challenge screen.
    if (await isTwoFactorEnabled(session.user.id)) {
      return { ok: true, redirectTo: '/verify-2fa' }
    }
  }

  // Administrators land in the admin dashboard: it is what they signed in to
  // do, and until this existed /admin was unreachable without typing it.
  return { ok: true, redirectTo: await landingFor(session.user!.id) }
}

/**
 * Confirms sign-in, establishes the session, and cancels the pending account deletion request.
 */
export async function confirmLoginAndCancelDeletionAction(formData: {
  /** The phone they signed in with, or the email for a legacy sign-in. */
  phone?: string
  email?: string
  password: string
  fingerprint?: string
}): Promise<ActionResult> {
  let email: string | null = null
  if (formData.phone) {
    const parsed = logInSchema.safeParse(formData)
    if (!parsed.success) return { ok: false, errorKey: 'invalidCredentials' }
    email = (await accountForPhone(normalisePhone(parsed.data.phone)))?.email ?? null
  } else {
    const parsed = legacyLogInSchema.safeParse(formData)
    if (!parsed.success) return { ok: false, errorKey: 'invalidCredentials' }
    email = parsed.data.email
  }
  if (!email) return { ok: false, errorKey: 'invalidCredentials' }
  const parsed = { data: { password: formData.password, fingerprint: formData.fingerprint } }

  const supabase = await createClient()
  const { data: session, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  })

  if (error || !session.user) {
    return { ok: false, errorKey: 'invalidCredentials' }
  }

  await clearLoginVerified()
  await recordSessionContext(session.session?.access_token, session.user.id)

  const { ip, userAgent, country } = await getRequestContext()
  try {
    await createAdminClient().rpc('record_auth_signal', {
      p_user_id: session.user.id,
      p_event_type: 'login',
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
      p_country: country ?? undefined,
      p_fingerprint: parsed.data.fingerprint || undefined,
    })
  } catch {
    // Never block
  }

  try {
    const { data: cancelled } = await createAdminClient().rpc('cancel_account_deletion', {
      p_user_id: session.user.id,
    })
    if (cancelled) {
      await createAdminClient().rpc('create_notification', {
        p_user_id: session.user.id,
        p_type: 'announcement',
        p_title: 'Account deletion cancelled',
        p_body:
          'Welcome back. Because you signed in, your account is no longer scheduled for deletion.',
        p_reference: {},
      })
    }
  } catch {
    // Never block a sign-in on this.
  }

  // Enrolled accounts finish signing in on the challenge screen.
  if (await isTwoFactorEnabled(session.user.id)) {
    return { ok: true, redirectTo: '/verify-2fa' }
  }

  return { ok: true, redirectTo: await landingFor(session.user.id) }
}

/**
 * Signs the user out while keeping their deletion schedule intact.
 */
export async function stayLoggedOutAction(): Promise<ActionResult> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  await clearLoginVerified()
  return { ok: true }
}

/**
 * Forgotten password, step 1: text a code to the account's phone.
 *
 * ALWAYS reports success whether or not the number has an account, so this is
 * not a membership oracle; the copy says "if an account uses this number".
 * Cooldown and hourly cap are swallowed for the same reason (they only exist
 * for numbers that have accounts). The screen's own countdown covers them.
 */
export async function requestPasswordResetAction(formData: {
  phone: string
}): Promise<ActionResult | CodeSent> {
  const parsed = forgotPasswordSchema.safeParse(formData)
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message, field: 'phone' }

  const phone = normalisePhone(parsed.data.phone)
  const account = await accountForPhone(phone)
  if (account) {
    const issued = await issueOtp({ purpose: 'reset_password', phone, userId: account.user_id })
    // A gateway failure is ours, not theirs, and saying so is worth more than
    // the sliver it reveals; everything else stays silent.
    if (!issued.ok && issued.reason === 'smsFailed') return issueError(issued)
  }
  return { ok: true, codeSent: true, resendSeconds: 60 }
}

/**
 * Forgotten password, step 2: the code, and the new password.
 *
 * No session is involved: the code IS the authorisation, it is bound to this
 * account and this purpose, and it dies on use or after five wrong tries.
 * Every session the account has is ended afterwards, because a reset is what
 * somebody does when they think the account is not theirs any more.
 */
export async function resetPasswordWithCodeAction(formData: {
  phone: string
  code: string
  password: string
  confirmPassword: string
}): Promise<ActionResult> {
  const phoneParsed = forgotPasswordSchema.safeParse(formData)
  if (!phoneParsed.success) return { ok: false, errorKey: phoneParsed.error.issues[0].message, field: 'phone' }
  const code = smsCode.safeParse(formData.code)
  if (!code.success) return { ok: false, errorKey: 'codeRequired', field: 'code' }
  const parsed = resetPasswordSchema.safeParse(formData)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, errorKey: issue.message, field: String(issue.path[0] ?? 'password') }
  }

  const phone = normalisePhone(phoneParsed.data.phone)
  const account = await accountForPhone(phone)
  // Same answer as a wrong code: nothing here may say whether the number is known.
  if (!account) return { ok: false, errorKey: 'codeExpired', field: 'code' }

  const checked = await checkOtp({
    purpose: 'reset_password',
    phone,
    userId: account.user_id,
    code: code.data,
  })
  if (!checked.ok) return checkError(checked)

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(account.user_id, {
    password: parsed.data.password,
  })
  if (error) {
    if (error.code === 'weak_password') return { ok: false, errorKey: 'passwordTooWeak', field: 'password' }
    reportUnexpected(error, 'auth.reset-password-by-code', { code: error.code ?? null })
    return { ok: false, errorKey: 'generic' }
  }

  const { error: revokeError } = await admin.rpc('revoke_all_sessions', { p_user_id: account.user_id })
  if (revokeError) reportUnexpected(revokeError, 'auth.reset-password-by-code.revoke-sessions')

  return { ok: true }
}

/**
 * LEGACY: reset by email link, for an account made before phone sign-in that
 * has not proved a phone yet. Without this, such a member who forgot their
 * password would have no way back in at all. Once the account has a verified
 * phone no mail is sent, silently, so this also reveals nothing.
 */
export async function forgotPasswordByEmailAction(formData: { email: string }): Promise<ActionResult> {
  const parsed = forgotPasswordEmailSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, errorKey: parsed.error.issues[0].message, field: 'email' }
  }

  const { data } = await createAdminClient().rpc('account_for_email', { p_email: parsed.data.email })
  const account = data?.[0]
  if (!account || account.phone_verified) return { ok: true }

  const supabase = await createClient()
  const origin = await getOrigin()
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  })
  return { ok: true }
}

/**
 * LEGACY: the second half of a reset by email link, setting the new password.
 *
 * This did not exist. `ResetPasswordForm` waited 400ms and then displayed the
 * generic error unconditionally — a placeholder left behind when the auth
 * wiring landed — so every reset that got all the way through the email link
 * failed at the last step, and said nothing useful about why.
 *
 * By the time anybody reaches the form, `/auth/confirm` has already redeemed
 * the recovery token and put a session on the request. That session IS the
 * authorisation: Supabase will only change the password of whoever the
 * cookie says we are, so there is no token to re-check here and nothing from
 * the client that decides whose password moves.
 */
export async function resetPasswordAction(formData: {
  password: string
  confirmPassword: string
}): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(formData)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, errorKey: issue.message, field: String(issue.path[0] ?? 'password') }
  }

  const supabase = await createClient()

  /*
    No session means the recovery link expired, was already used, or was
    opened in a different browser from the one now submitting. That is a
    specific, fixable situation and it must not be reported as "something
    went wrong" — the person needs to be told to request a new link.
  */
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, errorKey: 'resetLinkExpired' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    /*
      Supabase refuses a password identical to the current one. Somebody
      resetting because they forgot theirs can easily land on the old one, and
      "something went wrong" would send them round the whole email loop again
      to hit the same wall.
    */
    if (error.code === 'same_password') {
      return { ok: false, errorKey: 'passwordSameAsOld', field: 'password' }
    }
    if (error.code === 'weak_password') {
      return { ok: false, errorKey: 'passwordTooWeak', field: 'password' }
    }

    reportUnexpected(error, 'auth.reset-password', { code: error.code ?? null })
    return { ok: false, errorKey: 'generic', message: error.message }
  }

  /*
    A reset is what someone does when they think their account is not theirs
    any more, so ending every OTHER session is the point of it — leaving an
    attacker signed in on their own device would make the reset cosmetic.
    Best-effort: the password has already changed, and failing to tidy up
    sessions must not report the reset itself as failed.
  */
  const { error: revokeError } = await supabase.rpc('revoke_other_sessions')
  if (revokeError) reportUnexpected(revokeError, 'auth.reset-password.revoke-sessions')

  /*
    Then end this one too, and send them to log in with the new password. The
    success screen already offers exactly that. It also keeps the recovery
    session from turning into a signed-in session that never passed the
    second factor — the app shell would catch that anyway, but the shorter
    path is not to hand out the session at all.
  */
  await supabase.auth.signOut()
  await clearLoginVerified()

  return { ok: true }
}

export async function logOutAction(): Promise<ActionResult> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // Leaving this behind would let the next sign-in on this browser skip the
  // second factor entirely.
  await clearLoginVerified()
  return { ok: true, redirectTo: '/login' }
}
