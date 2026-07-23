import createMiddleware from 'next-intl/middleware'

import { routing } from '@/i18n/routing'

/**
 * Locale negotiation.
 *
 * This is also where the Ghana-only geo restriction (§6.9) and the Supabase
 * session refresh will attach, since both need to run before any page does.
 * Kept to locale handling for now so each concern lands with its own tests
 * rather than arriving as one unreviewable block.
 */
export default createMiddleware(routing)

export const config = {
  /*
    Skip API routes, Next.js internals and anything that looks like a static
    file. Running locale negotiation on every image request would add latency
    to the ad-view path for no benefit (§8).
  */
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
