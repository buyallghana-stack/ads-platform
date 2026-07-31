import 'server-only'

import { cache } from 'react'

import { normaliseRole, type AdminRole } from '@/lib/admin/role-types'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export * from '@/lib/admin/role-types'

/**
 * The signed-in staff member's role, straight from the database.
 *
 * Deliberately NOT from the JWT claim. The claim is stamped when a token is
 * issued, so a revoked administrator would keep it until their token refreshed
 * — up to an hour of access after somebody pressed Revoke. `admin_role` reads
 * the table, so revocation takes effect on the next request.
 */
export async function getAdminRole(): Promise<AdminRole | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const id = userData.user?.id
  if (!id) return null

  const { data } = await supabase.rpc('admin_role', { p_user_id: id })
  return normaliseRole(data as string | null)
}


/**
 * The staff role a given user holds, asked of the service client.
 *
 * SEPARATE FROM `getAdminRole` on purpose. That one asks the database as the
 * signed-in user and is right for a screen. This one takes a user id and uses
 * the service client, which is what the callers below need: some of them run
 * while a session is still being established and cannot rely on reading the
 * cookie, and the rest are server actions that already hold a verified id.
 *
 * ⚠️ THIS EXISTS BECAUSE FIVE COPIES OF THE SAME QUERY DID NOT. Until
 * 2026-07-31 each of them ran `.eq('role', 'admin')` — a literal string match —
 * and migration 086 renamed the only administrator's row to `super_admin`. The
 * admin link vanished from Profile, sign-in stopped landing on /admin, and the
 * gift-code, task and game screens quietly refused their own operator. One
 * helper, one place to be wrong.
 */
export const staffRoleOf = cache(async (userId: string): Promise<AdminRole | null> => {
  const { data } = await createAdminClient()
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)

  const held = (data ?? [])
    .map((row) => normaliseRole(row.role as string))
    .filter((role): role is AdminRole => role !== null)

  // Highest first — `user_roles` is keyed on (user_id, role), so nothing in
  // the schema stops somebody holding two.
  if (held.includes('super_admin')) return 'super_admin'
  return held[0] ?? null
})

/**
 * The signed-in user's id if they are a SUPER ADMIN, else null.
 *
 * The shape the admin server actions want: an id to pass to a database
 * function that will check it again, or nothing at all. Super admin rather
 * than any staff role, because every caller sits under `(super)` and the
 * database functions behind them all call `assert_admin`.
 */
export async function actingSuperAdminId(): Promise<string | null> {
  const user = await getSessionUser()
  if (!user) return null
  return (await staffRoleOf(user.id)) === 'super_admin' ? user.id : null
}
