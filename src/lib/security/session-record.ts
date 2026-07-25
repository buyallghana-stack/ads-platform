import 'server-only'

import { getRequestContext } from '@/lib/request-context'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Records which device and network a session was created from.
 *
 * Necessary because auth.sessions cannot know: sign-in runs in a Server
 * Action, so Supabase Auth sees our Vercel function — in production it stored
 * ip 13.37.225.184 (AWS Paris) and user agent "node" for a phone in Ghana.
 * Forwarding headers does not help; Supabase's gateway sets its own. So we
 * capture the context here, from the headers Vercel gives us, and the sessions
 * screen reads this instead.
 *
 * Call it immediately after any successful sign-in.
 */

/** Reads the session id out of a freshly issued access token. */
function sessionIdFrom(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    // The token came straight from Supabase in this same process, so it is
    // decoded, not verified — there is no untrusted party in between.
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof json.session_id === 'string' ? json.session_id : null
  } catch {
    return null
  }
}

export async function recordSessionContext(
  accessToken: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!accessToken) return

  const sessionId = sessionIdFrom(accessToken)
  if (!sessionId) return

  try {
    const { ip, userAgent, country } = await getRequestContext()
    await createAdminClient().rpc('record_session_context', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_user_agent: userAgent ?? '',
      p_ip: ip ?? '',
      p_country: country ?? '',
    })
  } catch {
    // Bookkeeping must never break a sign-in.
  }
}
