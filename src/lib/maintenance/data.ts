import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Whether the member app is closed to the person making this request.
 *
 * ⚠️ THE WHOLE DECISION IS ONE DATABASE CALL, AND THAT IS THE POINT. The first
 * version assembled it here: read two config rows, read a role, compare an
 * email. Every part of it worked when run from a script against production,
 * and in the deployed app it shut everybody out, staff and the allow-listed
 * test account included. Two rounds of testing against a runtime with no logs
 * I can read got no closer to which half was failing.
 *
 * `maintenance_closed_for_me()` can be asked from a SQL prompt and answers the
 * same way every time. It is SECURITY DEFINER, so it reads the two private
 * config keys itself rather than needing them handed over, and it answers about
 * the CALLER, so this is read through the USER's client and no service key
 * goes near it.
 *
 * ⚠️ IT FAILS OPEN, in both places. A read that errors leaves the app usable:
 * a hiccup locking every member out of a working product is far worse than a
 * maintenance window that starts a minute late.
 */
export async function isMaintenanceClosed(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('maintenance_closed_for_me')

  if (error) return false
  return data === true
}
