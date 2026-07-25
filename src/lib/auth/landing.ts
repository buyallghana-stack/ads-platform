import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Where a person belongs after signing in.
 *
 * There is no separate admin login, and there should not be: an administrator
 * is a user with a role, not a second account, and a second sign-in form is a
 * second place for a password to go wrong. What was missing is this — every
 * path landed on /dashboard, so an admin signed in and saw the user app with
 * nothing anywhere pointing at /admin. The dashboard existed and was
 * unreachable unless you knew to type the URL.
 *
 * Asked of user_roles through the service client rather than is_admin(),
 * because is_admin() reads auth.uid() and the callers here run at the moment
 * a session is being established — the cookie is not reliably readable yet.
 * The user id comes from the verified session in every caller, never from a
 * payload.
 */
export const isAdminUser = cache(async (userId: string): Promise<boolean> => {
  const { data } = await createAdminClient()
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle()

  return Boolean(data)
})

/** '/admin' for administrators, '/dashboard' for everybody else. */
export async function landingFor(userId: string): Promise<'/admin' | '/dashboard'> {
  return (await isAdminUser(userId)) ? '/admin' : '/dashboard'
}
