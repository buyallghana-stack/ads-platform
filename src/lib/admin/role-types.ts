/**
 * Who is allowed into which part of the console — the rules alone.
 *
 * No server imports: the admin nav is a client component and needs
 * `areaAllowed` to decide which links to draw. `roles.ts` holds the part that
 * reads the database and is `server-only`; splitting them is the same division
 * as `leaderboard/types.ts` and `leaderboard/data.ts`.
 *
 * Three staff roles as of 2026-07-31 (operator): a SUPER ADMIN, who can do
 * everything including adding and revoking other administrators; SUPPORT, for
 * the message queue; and an ADS MANAGER, for ads and advertisers.
 *
 * WHERE THIS IS ENFORCED, and why it is not on every page. The console is laid
 * out so that the check has one home per area rather than one per screen:
 * everything a super admin alone may see lives under the `(super)` route group
 * and is covered by that group's layout, and the two delegated areas have a
 * layout each. A new screen added inside `(super)` is protected because of
 * where its file is, which is the only kind of protection nobody forgets to
 * add. Route groups are parentheses in the folder name, so none of this
 * changes a single URL.
 *
 * The database enforces it a second time and does not take our word for any of
 * it: `assert_admin` means super admin, so every admin function that does not
 * explicitly name an area is closed to the other two roles whatever the app
 * believes.
 */

export const ADMIN_ROLES = ['super_admin', 'support', 'ads_manager'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

/** The areas a role can act in. `super` is everything else. */
export type AdminArea = 'super' | 'support' | 'ads'

/**
 * `admin` is the name the single administrator's role had before this split.
 * It is still accepted everywhere as a synonym for `super_admin`, because a
 * browser holding a token issued before the change would otherwise lock its
 * owner out of their own console.
 */
export function normaliseRole(raw: string | null | undefined): AdminRole | null {
  if (raw === 'admin' || raw === 'super_admin') return 'super_admin'
  if (raw === 'support' || raw === 'ads_manager') return raw
  return null
}

export function areaAllowed(role: AdminRole | null, area: AdminArea): boolean {
  if (role === 'super_admin') return true
  if (role === 'support') return area === 'support'
  if (role === 'ads_manager') return area === 'ads'
  return false
}

/** Where a role lands when it opens the console, or is sent somewhere it may not go. */
export function homeForRole(role: AdminRole | null): string {
  if (role === 'support') return '/admin/messages'
  if (role === 'ads_manager') return '/admin/ads'
  return '/admin'
}
