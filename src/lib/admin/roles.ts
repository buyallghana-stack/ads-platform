import 'server-only'

import { normaliseRole, type AdminRole } from '@/lib/admin/role-types'
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
