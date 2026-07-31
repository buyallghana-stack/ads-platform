import 'server-only'

import { homeForRole, staffRoleOf } from '@/lib/admin/roles'

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
 *
 * ANY STAFF ROLE COUNTS, not the literal string 'admin'. This asked for
 * `role = 'admin'` until 2026-07-31, and migration 086 renamed that row to
 * `super_admin` — so the operator's own Admin link disappeared from Profile
 * and their sign-in stopped landing on the console. The role vocabulary now
 * lives in one place; see `staffRoleOf`.
 */
export async function isAdminUser(userId: string): Promise<boolean> {
  return (await staffRoleOf(userId)) !== null
}

/**
 * Where signing in should land somebody.
 *
 * Not just '/admin': support lands on the message queue and an ads manager on
 * ads, because the overview is a screen neither of them may open.
 */
export async function landingFor(userId: string): Promise<string> {
  return homeForRole(await staffRoleOf(userId))
}
