'use server'

import { clearLoginVerified, isTwoFactorEnabled } from '@/lib/security/login-2fa'
import { recordSessionContext } from '@/lib/security/session-record'
import { verifyTurnstile } from '@/lib/fraud/turnstile'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { landingFor } from '@/lib/auth/landing'
import { getOrigin, getRequestContext } from '@/lib/request-context'
import {
  forgotPasswordSchema,
  logInSchema,
  signUpSchema,
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
  /** Device fingerprint from the browser. Optional — see signUpSchema. */
  fingerprint?: string
  /** Turnstile token. Only checked when the operator has set keys. */
  turnstileToken?: string
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
    The bot check goes FIRST, before any database work and before the account
    exists — the whole point of it is to stop automated registration cheaply,
    and doing it after two round trips concedes most of that.

    A no-op unless the operator has set Turnstile keys; see `turnstile.ts`.
  */
  const bot = await verifyTurnstile(data.turnstileToken)
  if (!bot.ok) {
    /*
      LOGGED, because the first production report of this was undiagnosable:
      the operator saw "we could not confirm you are a person" while the widget
      beside it read Success, and nothing recorded which of Cloudflare's error
      codes came back. Codes only — no token, no address.
    */
    console.error('[turnstile] refused:', bot.reason)

    /*
      NO `field` HERE, and it is not a detail. The form routes a field-tagged
      error to that input with `setError`, and the bot check is not an input —
      so tagging it sent the message to a control that does not exist and the
      form silently did nothing when somebody pressed Create account. Caught in
      testing with the challenge script blocked, which is exactly how a real
      person meets this: an ad blocker, a dead network, a proxy.
    */
    return { ok: false, errorKey: bot.retry ? 'botCheckRetry' : 'botCheckFailed' }
  }

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
    A deleted account's email and phone may never come back (operator spec
    2026-07-25). Checked against hashes, so nothing here reveals WHO left —
    and the message stays generic for the same reason.
  */
  const { data: blocked } = await admin.rpc('is_identity_blocked', {
    p_email: data.email,
    p_phone: data.phone,
  })
  if (blocked) return { ok: false, errorKey: 'identityBlocked', field: 'email' }

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
  const origin = await getOrigin()
  const { data: signUp, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      /*
        Where the link in the confirmation email points. Without it Supabase
        falls back to the project's Site URL — which is a single fixed value,
        still set to localhost, and would have emailed every real user a link
        to their own machine.
      */
      emailRedirectTo: `${origin}/auth/confirm?next=/dashboard`,
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
    /*
      Supabase's built-in mailer allows only a few messages an hour, and a
      signup whose confirmation email cannot be sent fails whole — GoTrue rolls
      the account back, so there is nothing half-created to recover. Verified
      while testing this file: three attempts, three 429s, and no rows left in
      auth.users afterwards.

      It gets its own message because the raw one ("email rate limit exceeded")
      tells a person nothing about the only move they have, which is to wait.
      Until Resend is wired this is a real launch-day failure mode, not a
      theoretical one.
    */
    if (signUpError?.code === 'over_email_send_rate_limit' || signUpError?.status === 429) {
      return { ok: false, errorKey: 'emailSendLimit' }
    }

    /*
      THE MAIL SERVER REFUSED THE ADDRESS. Seen in production on 2026-07-29:
      Resend's test sender answers 550 for every recipient except the account
      owner, GoTrue turns that into a 500, and the account is rolled back. The
      person did nothing wrong and there is nothing they can do about it, so
      they are told that rather than blamed.
    */
    if (signUpError?.status === 500 || /send email|smtp|550/i.test(signUpError?.message ?? '')) {
      console.error('[signup] mail send failed:', signUpError?.message)
      return { ok: false, errorKey: 'emailSendFailed' }
    }

    /*
      NEVER SURFACE A MESSAGE THAT IS NOT A SENTENCE. The 500 above arrived as
      the string "{}" — an empty JSON body — and went straight into the red
      banner at the top of the signup form, which is what the operator saw.
      Anything that looks like serialised data is dropped for the generic copy.
    */
    const raw = signUpError?.message?.trim()
    const usable = raw && !/^[[{]/.test(raw) && raw.length > 3 ? raw : undefined
    if (!usable) console.error('[signup] unusable error from Supabase:', raw)
    return { ok: false, errorKey: 'generic', message: usable }
  }

  const userId = signUp.user.id

  // Signing up may issue a session immediately (when email confirmation is
  // off); record its device context if so.
  await recordSessionContext(signUp.session?.access_token, userId)

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
      p_fingerprint: data.fingerprint || undefined,
    })

    await admin.rpc('evaluate_signup_fraud', {
      p_user_id: userId,
      p_email: data.email,
      p_phone: data.phone,
      p_ip: ip ?? undefined,
      // Wired 2026-07-29. This argument has existed since the fraud layer was
      // built and was passed `undefined` the whole time, which left
      // `device_multi_account` (weight 30) and `self_referral_suspected` (35)
      // unable to fire at all — the two highest-weighted device checks on a
      // platform whose main fraud is one person running many accounts.
      p_fingerprint: data.fingerprint || undefined,
    })

    if (referrerId && data.referralCode) {
      await admin.rpc('apply_referral_code', {
        p_referee_id: userId,
        p_code: data.referralCode,
        p_ip: ip ?? undefined,
        // Referrer and referee on one device is self-referral, and it is
        // exactly what a referral bonus invites. This is the argument that
        // lets `apply_referral_code` see it.
        p_fingerprint: data.fingerprint || undefined,
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
  /** Device fingerprint from the browser. Optional — see signUpSchema. */
  fingerprint?: string
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

  /*
    A fresh password sign-in never inherits a previous challenge: clear the
    marker first, so an enrolled account is always asked again. Doing it before
    the redirect decision means a failure anywhere below still leaves the
    session half-authenticated rather than fully trusted.
  */
  await clearLoginVerified()

  if (session.user) {
    // Capture the real device/IP for this session while we still have the
    // browser's request context — auth.sessions only ever sees our server.
    await recordSessionContext(session.session?.access_token, session.user.id)

    const { ip, userAgent, country } = await getRequestContext()
    try {
      await createAdminClient().rpc('record_auth_signal', {
        p_user_id: session.user.id,
        p_event_type: 'login',
        p_ip: ip ?? undefined,
        p_user_agent: userAgent ?? undefined,
        p_country: country ?? undefined,
        // Signals on SIGN-IN too, not just signup. Somebody who registers ten
        // accounts from ten places and then farms them all from one phone is
        // invisible to a signup-only check, and that is the cheaper attack.
        p_fingerprint: parsed.data.fingerprint || undefined,
      })
    } catch {
      // A missing login signal must never block a login.
    }

    /*
      Signing in IS the cancel gesture for a pending deletion (operator spec
      2026-07-25). Done here rather than behind the 2FA challenge on purpose:
      the person has proved the password on an account they asked to delete,
      and the kind reading — they came back — is also the reversible one. The
      request can always be made again.
    */
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
  }

  // Administrators land in the admin dashboard: it is what they signed in to
  // do, and until this existed /admin was unreachable without typing it.
  return { ok: true, redirectTo: await landingFor(session.user!.id) }
}

/**
 * Send the confirmation email again.
 *
 * The only action /verify offers now. Verification itself happens when the
 * person clicks the link, which lands on /auth/confirm — there is no code to
 * type and therefore nothing to get wrong, mistype, or phish out of somebody
 * over the phone.
 *
 * Supabase rate-limits this server-side; the screen's countdown is a courtesy
 * on top, not the control.
 */
export async function resendConfirmationAction(email: string): Promise<ActionResult> {
  const supabase = await createClient()
  const origin = await getOrigin()

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/dashboard` },
  })

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
  const origin = await getOrigin()
  /*
    The reset mail is a link as well, and it needs somewhere to go: without a
    redirectTo it lands on the Site URL with the token attached, which is not
    the reset form and cannot complete the reset.
  */
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  })
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
