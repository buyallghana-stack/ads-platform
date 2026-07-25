'use server'

import { getSessionUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

/**
 * Session actions.
 *
 * Unlike the money and 2FA actions these go through the RLS USER client, not
 * the admin client: `revoke_session` and `revoke_other_sessions` are scoped by
 * auth.uid() inside the function, so the caller's own token is the
 * authorisation. Reaching for the service role here would replace a check the
 * database is already making with one this file would have to make correctly.
 */
export type SessionActionResult = { ok: true; count?: number } | { ok: false; errorKey: string }

export async function revokeSession(sessionId: string): Promise<SessionActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('revoke_session', { p_session_id: sessionId })
  if (error) {
    if (/current session/i.test(error.message)) return { ok: false, errorKey: 'isCurrent' }
    return { ok: false, errorKey: 'generic' }
  }
  if (!data) return { ok: false, errorKey: 'notFound' }
  return { ok: true }
}

export async function revokeOtherSessions(): Promise<SessionActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('revoke_other_sessions')
  if (error) return { ok: false, errorKey: 'generic' }
  return { ok: true, count: Number(data ?? 0) }
}
