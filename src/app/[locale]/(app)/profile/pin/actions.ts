'use server'

import { createClient as createStatelessClient } from '@supabase/supabase-js'

import { getSessionUser } from '@/lib/auth/session'
import { clientEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Withdrawal-PIN server actions.
 *
 * All PIN state lives behind SECURITY DEFINER functions revoked from every
 * client role, so these run via the service-role admin client, and the user id
 * always comes from the verified session — never the payload. The PIN itself is
 * hashed in the database; the browser never sees a hash and the server never
 * stores plaintext.
 */
export type PinResult = { ok: true } | { ok: false; errorKey?: string; message?: string }

const PIN_RE = /^[0-9]{4}$/

/** Set the PIN, or change it with the current one. */
export async function setWithdrawalPin(input: {
  newPin: string
  currentPin?: string
}): Promise<PinResult> {
  if (!PIN_RE.test(input.newPin)) return { ok: false, errorKey: 'pinFormat' }

  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('set_withdrawal_pin', {
    p_user_id: user.id,
    p_new_pin: input.newPin,
    p_current_pin: input.currentPin ?? undefined,
  })
  if (error) {
    // Map the known raise to a translatable key; pass anything else through.
    if (/current pin/i.test(error.message)) return { ok: false, errorKey: 'wrongCurrent' }
    return { ok: false, message: error.message }
  }
  return { ok: true }
}

/**
 * Reset a forgotten PIN. Identity is re-verified by the account PASSWORD here
 * (the step-up becomes an authenticator app once 2FA ships). The password is
 * checked on a throwaway client so the user's real session is untouched.
 */
export async function resetWithdrawalPin(input: {
  password: string
  newPin: string
}): Promise<PinResult> {
  if (!PIN_RE.test(input.newPin)) return { ok: false, errorKey: 'pinFormat' }

  const user = await getSessionUser()
  if (!user?.email) return { ok: false, errorKey: 'notSignedIn' }

  // Verify the password without disturbing the current session.
  const stateless = createStatelessClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error: pwError } = await stateless.auth.signInWithPassword({
    email: user.email,
    password: input.password,
  })
  if (pwError) return { ok: false, errorKey: 'wrongPassword' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('reset_withdrawal_pin', {
    p_user_id: user.id,
    p_new_pin: input.newPin,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
