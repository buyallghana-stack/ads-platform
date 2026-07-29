import { type NextRequest } from 'next/server'

import createIntlMiddleware from 'next-intl/middleware'

import { routing } from '@/i18n/routing'
import { updateSession } from '@/lib/supabase/middleware'

const handleI18n = createIntlMiddleware(routing)

/**
 * Locale negotiation and Supabase session refresh.
 *
 * Order matters. The intl middleware builds the response — it may rewrite or
 * redirect for locale — and the session refresh then writes its cookies onto
 * whatever response comes back. Refreshing first would attach cookies to a
 * response that intl subsequently replaces, and the session would silently
 * fail to persist.
 *
 * The Ghana-only geo restriction (§6.9) attaches here too, once
 * GEO_RESTRICTION_ENABLED is switched on.
 */
export default async function middleware(request: NextRequest) {
  const response = handleI18n(request)
  await updateSession(request, response)
  return response
}

export const config = {
  /*
    Skip API routes, Next.js internals and anything that looks like a static
    file. Running a session refresh on every image request would add a network
    round trip to the ad-view path for no benefit (§8).

    `auth` is skipped too, and that one is load-bearing: /auth/confirm is the
    address printed inside every verification email. Locale negotiation would
    rewrite it to /en/auth/confirm — not a route — and every link already sent
    would 404. An emailed URL has to stay exactly what was emailed.

    `monitoring` is the Sentry tunnel, and it is load-bearing for the same
    reason: the SDK posts events to /monitoring, locale negotiation would
    rewrite that to /en/monitoring, and every error report would 404 into a
    dashboard that looked reassuringly quiet.
  */
  matcher: ['/((?!api|auth|monitoring|_next|_vercel|.*\\..*).*)'],
}
