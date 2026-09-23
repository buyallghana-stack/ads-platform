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
 * ⚠️ AND IT TAKES THE USER AS AN ARGUMENT, WHICH IS NOT DECORATION. The first
 * version of the function took none, on the reasoning that it should only ever
 * answer about the caller. Correct as a security property and fatal as an HTTP
 * one: every member's request was byte-identical apart from the Authorization
 * header, so the framework's fetch cache treated them as the same request and
 * handed the first answer to everyone. An ordinary member hit it first, the
 * answer was "closed", and staff and the allow-listed account were served that
 * same cached "closed". Asked directly from a SQL prompt it had been returning
 * the right answer for every account the whole time, which is how two rounds of
 * debugging went straight past it.
 *
 * It is SECURITY DEFINER, so it reads the two private config keys itself rather
 * than needing them handed over, and the database still enforces that you may
 * only ask about yourself unless you are staff.
 *
 * ⚠️ IT FAILS OPEN, in both places. A read that errors leaves the app usable:
 * a hiccup locking every member out of a working product is far worse than a
 * maintenance window that starts a minute late.
 */
export async function isMaintenanceClosed(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('maintenance_closed_for', { p_user_id: userId })

  if (error) return false
  return data === true
}
