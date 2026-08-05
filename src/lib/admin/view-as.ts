import 'server-only'

import { cookies } from 'next/headers'
import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * "View as user" — a super admin looking at somebody's own screens, read only.
 *
 * WHAT THIS IS NOT: a sign-in. The admin keeps their own Supabase session the
 * whole time. This cookie carries a short-lived token that the SERVER reads to
 * decide whose rows to render, and nothing else. It is not accepted anywhere
 * near the login page, it cannot be exchanged for a session, and the admin
 * never sees the target's credentials.
 *
 * WHY IT IS BUILT THIS WAY. The obvious implementation — mint a real session
 * for the target with the auth admin API — makes the admin genuinely BE that
 * user. Read-only would then rest on remembering a check in every one of the
 * dozens of server actions that move points, request payouts, change payout
 * details or delete an account. One forgotten check is an admin spending
 * somebody's balance. Here the identity used for WRITES never changes, so a
 * forgotten check fails in the safe direction: the action would touch the
 * ADMIN's own account, not the user's.
 *
 * Three layers stop a write, in firing order:
 *
 *   1. `middleware.ts` refuses every non-GET request while the cookie is
 *      present. Server actions are POSTs, so this is one choke point covering
 *      all of them, present and future.
 *   2. Server actions keep calling `getSessionUser()`, which always returns
 *      the real admin — never the person being viewed.
 *   3. The screens are rendered with `getViewerUser()`, which is read-only by
 *      construction: it feeds queries, not mutations.
 *
 * The token is verified against the database on every request rather than
 * trusted from the cookie, and that lookup re-checks that the admin is STILL a
 * super admin — a revoked administrator's open look dies on their next page
 * load.
 */

export const VIEW_AS_COOKIE = 'sp_view_as'

export type ViewAsSession = {
  adminId: string
  targetUserId: string
  expiresAt: string
}

/**
 * The active viewing session, or null.
 *
 * Cached per request: the layout, the banner and the page all ask, and this
 * costs a database round trip.
 */
export const getViewAsSession = cache(async (): Promise<ViewAsSession | null> => {
  const token = (await cookies()).get(VIEW_AS_COOKIE)?.value
  if (!token) return null

  const { data, error } = await createAdminClient()
    .rpc('admin_active_view_session', { p_token: token })
    .maybeSingle()

  if (error || !data) return null

  return {
    adminId: data.admin_id as string,
    targetUserId: data.target_user_id as string,
    expiresAt: data.expires_at as string,
  }
})

/*
 * The list of screens shut while viewing lives in `middleware.ts`, not here.
 * It has to be enforced before a route renders, and middleware cannot import
 * this module — it is `server-only` and pulls in the service client. One copy,
 * in the place that can actually act on it.
 */
