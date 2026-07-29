import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Who holds the admin role, and whether they are protected.
 *
 * `twoFactor` is the fact this list exists to show. An administrator without
 * an authenticator is the weakest point in the payout queue, and the screen
 * needs to make that visible BEFORE `require_admin_2fa` is switched on —
 * turning that setting on while somebody has no authenticator sends them to
 * enrol, which is recoverable, but the operator should know first.
 *
 * Enrolled means CONFIRMED, not "started": a half-finished enrolment leaves a
 * secret behind with no confirmation, and counting it as protected would be
 * exactly the wrong way to be wrong here.
 */

export type Administrator = {
  id: string
  name: string
  email: string
  twoFactor: boolean
  grantedAt: string
  lastSeenAt: string | null
  /** True for the admin looking at the screen. */
  isYou: boolean
}

type Row = {
  id: string
  name: string
  email: string
  two_factor: boolean
  granted_at: string
  last_seen_at: string | null
  is_you: boolean | null
}

export async function getAdministrators(): Promise<Administrator[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_administrators')

  if (error) throw new Error(`Could not load administrators: ${error.message}`)

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    twoFactor: row.two_factor,
    grantedAt: row.granted_at,
    lastSeenAt: row.last_seen_at,
    isYou: row.is_you === true,
  }))
}
