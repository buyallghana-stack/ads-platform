import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

import { cookies } from 'next/headers'

import { requireTotpKey } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Sign-in gating for accounts with 2FA switched on (operator direction
 * 2026-07-25: enrolling protects the sign-in itself, not only sensitive
 * changes).
 *
 * Supabase issues the session the moment the password checks out, so the
 * factor cannot be enforced by withholding a session. Instead the session is
 * treated as HALF authenticated until a code is accepted: the app shell
 * refuses to render for an enrolled user without this cookie, and every
 * password sign-in clears it, so a code is demanded on each new sign-in.
 *
 * The cookie is HMAC-signed and bound to the user id, so it cannot be forged,
 * replayed by a different account, or extended past its expiry. It carries no
 * secret — only a claim that this browser passed the check.
 *
 * The expiry is SIGNED INTO the cookie, so shortening
 * `two_factor_recheck_hours` applies to checks passed after the change, not
 * to ones already issued. That is the honest behaviour — the alternative is
 * re-deriving the window on every read, which would let lengthening the
 * setting silently extend a check somebody passed last week.
 */
const COOKIE = 'sp_2fa'

/**
 * How long a passed check lasts, in hours, from `two_factor_recheck_hours`.
 *
 * Was hardcoded to 12. It is a setting now because the operator's own
 * /admin/settings screen offered a control for it and had nothing behind it —
 * and because the right number genuinely differs between "one operator on
 * their own laptop" and "several people sharing a machine in an office".
 *
 * THE FALLBACK IS THE OLD VALUE, not zero and not unlimited. This runs on the
 * sign-in path, and a config read that fails must not silently turn a
 * security window into either an instant re-challenge or an eternal one.
 */
const DEFAULT_RECHECK_HOURS = 12

async function maxAgeSeconds(): Promise<number> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('app_config')
      .select('value')
      .eq('key', 'two_factor_recheck_hours')
      .maybeSingle()
    const hours = Number(data?.value)
    return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_RECHECK_HOURS) * 3600
  } catch {
    return DEFAULT_RECHECK_HOURS * 3600
  }
}

function sign(userId: string, expiry: number): string {
  return createHmac('sha256', requireTotpKey())
    .update(`${userId}.${expiry}`)
    .digest('base64url')
}

/** Record that this browser passed the 2FA challenge for this user. */
export async function markLoginVerified(userId: string): Promise<void> {
  const seconds = await maxAgeSeconds()
  const expiry = Date.now() + seconds * 1000
  const store = await cookies()
  store.set(COOKIE, `${expiry}.${sign(userId, expiry)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: seconds,
  })
}

export async function clearLoginVerified(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE)
}

/** Has this browser already passed the challenge for this user? */
export async function hasPassedLoginChallenge(userId: string): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value
  if (!raw) return false

  const [expiryPart, signature] = raw.split('.')
  const expiry = Number(expiryPart)
  if (!expiry || !signature || Date.now() > expiry) return false

  // Constant-time compare so a forged cookie cannot be tuned byte by byte.
  const expected = Buffer.from(sign(userId, expiry))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/**
 * Is 2FA switched on for this account? Read with the service-role client
 * because user_security has no client read policy at all.
 */
export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('user_security')
    .select('totp_confirmed_at')
    .eq('user_id', userId)
    .maybeSingle()
  return Boolean(data?.totp_confirmed_at)
}

/** True when this user must pass a code before the app may be shown. */
export async function needsLoginChallenge(userId: string): Promise<boolean> {
  if (!(await isTwoFactorEnabled(userId))) return false
  return !(await hasPassedLoginChallenge(userId))
}

/**
 * Does this administrator have to enrol before the admin area will open?
 *
 * True only when `require_admin_2fa` is on AND they have not confirmed an
 * authenticator. Called from the admin layout, which is the one choke point
 * every admin route passes through.
 *
 * FAILS OPEN, and that is deliberate on this particular check. If the config
 * read fails, the alternative is locking every administrator out of the payout
 * queue because a query timed out — and the thing on the other side of this
 * door is already behind a password, a role check and, for an enrolled
 * account, a second factor. A failed read must not be an outage.
 */
export async function adminNeedsTwoFactor(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()

    const [{ data: cfg }, { data: sec }] = await Promise.all([
      admin.from('app_config').select('value').eq('key', 'require_admin_2fa').maybeSingle(),
      admin
        .from('user_security')
        .select('totp_confirmed_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ])

    if (cfg?.value !== 'true') return false
    return !sec?.totp_confirmed_at
  } catch {
    return false
  }
}
