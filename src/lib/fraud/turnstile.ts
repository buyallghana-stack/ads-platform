import 'server-only'

/**
 * Cloudflare Turnstile — the "is there a person here" check on signup.
 *
 * INERT UNTIL THE KEYS EXIST, and that is the whole design. Turnstile needs a
 * site key and a secret key from a Cloudflare account, which is the operator's
 * to create. Rather than leave the work undone until those arrive, the code is
 * here and switches itself on the moment both are set:
 *
 *   neither set  → `turnstileEnabled()` is false. No widget renders, no token
 *                  is expected, and verification returns ok. Exactly the
 *                  behaviour before this file existed.
 *   both set     → the widget renders, and a signup without a valid token is
 *                  refused.
 *
 * The alternative — shipping it always-on — would mean a missing environment
 * variable in production silently blocking every registration, which is a
 * worse failure than the bots it prevents.
 *
 * ONLY SIGNUP. Not login: a legitimate user who fails a bot check on their own
 * account is locked out of money they have earned, and the thing worth
 * stopping here is bulk account creation.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
}

export type TurnstileResult = { ok: true } | { ok: false; reason: string }

/**
 * Verify a token with Cloudflare.
 *
 * FAILS OPEN ON A NETWORK ERROR, deliberately. If Cloudflare is unreachable
 * the choice is between letting a signup through unverified and refusing every
 * signup for as long as the outage lasts. For a platform whose whole funnel is
 * registration, refusing everybody is the more expensive failure — and the
 * account still passes through every other fraud check, which do not depend on
 * anybody else's uptime.
 *
 * An INVALID token is a different thing entirely and is always refused.
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip?: string | null,
): Promise<TurnstileResult> {
  if (!turnstileEnabled()) return { ok: true }

  if (!token) return { ok: false, reason: 'missing' }

  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY!,
      response: token,
    })
    // Cloudflare uses this to spot a token replayed from somewhere else.
    if (ip) body.set('remoteip', ip)

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      // A challenge that hangs must not hang the signup behind it.
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return { ok: true }

    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) return { ok: true }

    return { ok: false, reason: data['error-codes']?.join(', ') || 'rejected' }
  } catch {
    // Unreachable or timed out — see the note above.
    return { ok: true }
  }
}
