import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

import { VIEW_AS_COOKIE } from '@/lib/admin/view-as'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * End a "view as user" session and go back to the admin console.
 *
 * A GET, and under `/api`, for one reason: `middleware.ts` refuses every
 * non-GET request while the viewing cookie is set, and its matcher skips
 * `/api` entirely. A POST action here would be refused by the very block it
 * exists to lift — the admin would be stuck inside the session with no way
 * out but clearing cookies by hand.
 *
 * Safe as a GET because it only ENDS something. The worst a forged link can do
 * is return an administrator to their own account.
 *
 * The cookie is cleared even if the database call fails: the session expires on
 * its own, and leaving a stuck cookie behind would keep the whole app read-only
 * for an admin who has already left.
 */
export async function GET(request: NextRequest) {
  const store = await cookies()
  const token = store.get(VIEW_AS_COOKIE)?.value

  if (token) {
    try {
      await createAdminClient().rpc('admin_end_view_session', { p_token: token })
    } catch {
      // Deliberately swallowed — see above.
    }
  }

  store.delete(VIEW_AS_COOKIE)

  return NextResponse.redirect(new URL('/admin/users', request.nextUrl.origin))
}
