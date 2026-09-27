import { NextResponse, type NextRequest } from 'next/server'

import type { EmailOtpType } from '@supabase/supabase-js'

import { recordSessionContext } from '@/lib/security/session-record'
import { createClient } from '@/lib/supabase/server'

/**
 * Where an emailed verification LINK lands.
 *
 * Supabase puts `{{ .ConfirmationURL }}` in the mail; that URL carries a
 * one-time `token_hash` and the `type` of thing being confirmed. This handler
 * exchanges it for a session and sends the person on. Nothing here is a
 * password: the token is single-use, short-lived, and useless once redeemed.
 *
 * Deliberately OUTSIDE the [locale] segment and excluded from the intl
 * middleware. A link in an email must not depend on locale negotiation — the
 * middleware would rewrite /auth/confirm to /en/auth/confirm, which is not a
 * route, and every confirmation email in circulation would 404.
 *
 * Since 2026-09-27 (phone sign-in) the only email that should still arrive is
 * the LEGACY password reset for an account that never proved a phone, plus
 * staff invitations. The other types are kept working for links already in
 * people's inboxes.
 *
 * The three types that reach here:
 *   signup        first-time address confirmation
 *   email_change  a changed address proving itself before the change takes
 *   recovery      a password reset, which then needs the reset form
 */

/** Only same-site paths. `next` comes from a URL, so it is attacker-supplied;
 *  without this it is an open redirect wearing our domain in a phishing mail. */
function safeNext(value: string | null): string {
  if (!value) return '/dashboard'
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)

  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeNext(searchParams.get('next'))

  /* A dead link is almost always an old reset mail, so the answer is the
     place to ask for a fresh reset. The reason is kept on the URL for logs. */
  const fail = (reason: 'link' | 'expired') =>
    NextResponse.redirect(`${origin}/forgot-password?error=${reason}`)

  // A link that arrives without its token is a mail client that mangled it, or
  // somebody guessing the URL. Same answer either way.
  if (!tokenHash || !type) return fail('link')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error || !data.user) return fail('expired')

  /*
    Confirming signs them in, so this session needs its real device and IP
    recorded like any other — auth.sessions only ever sees our server.
    Best-effort: a failure here must not cost somebody their confirmation.
  */
  try {
    await recordSessionContext(data.session?.access_token, data.user.id)
  } catch {
    // Intentionally ignored.
  }

  // A recovery link has to land on the form that sets the new password; the
  // caller says so via `next`, and this is only the fallback.
  const destination = type === 'recovery' && next === '/dashboard' ? '/reset-password' : next

  return NextResponse.redirect(`${origin}${destination}`)
}
