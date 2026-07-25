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
 */
const COOKIE = 'sp_2fa'
const MAX_AGE_SECONDS = 60 * 60 * 12 // Re-challenge twice a day at most.

function sign(userId: string, expiry: number): string {
  return createHmac('sha256', requireTotpKey())
    .update(`${userId}.${expiry}`)
    .digest('base64url')
}

/** Record that this browser passed the 2FA challenge for this user. */
export async function markLoginVerified(userId: string): Promise<void> {
  const expiry = Date.now() + MAX_AGE_SECONDS * 1000
  const store = await cookies()
  store.set(COOKIE, `${expiry}.${sign(userId, expiry)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
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
