import { NextResponse, type NextRequest } from 'next/server'

import createIntlMiddleware from 'next-intl/middleware'

import { routing } from '@/i18n/routing'
import { updateSession } from '@/lib/supabase/middleware'

/* Inlined rather than imported from `@/lib/admin/view-as`: that module is
   `server-only` and pulls in the service client, neither of which belongs in
   the middleware bundle. */
const VIEW_AS_COOKIE = 'sp_view_as'

/* The affiliate visitor token. A random id and nothing else — no user, no
   affiliate code, nothing that identifies a person if it leaks. Thirty days,
   matching the attribution window. */
const VISITOR_COOKIE = 'sp_v'
const VISITOR_MAX_AGE = 60 * 60 * 24 * 30

/*
  Screens that stay shut even while viewing.

  The operator asked for this to look through somebody's ACTIVITIES. Their
  two-factor state, their active sessions, their saved payout destination and
  the screens for changing an email, PIN or password are not activities — they
  are the account's security surface, and there is no support reason to read
  them. Matched by prefix, so a screen added under `profile/` tomorrow is shut
  by default rather than open until somebody notices.
*/
const SHUT_WHILE_VIEWING = [
  '/profile/2fa',
  '/profile/backup-codes',
  '/profile/credentials',
  '/profile/password',
  '/profile/email',
  '/profile/pin',
  '/profile/sessions',
  '/profile/delete',
]

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
  /*
    "VIEW AS USER" IS READ ONLY, AND THIS IS WHERE THAT IS TRUE.

    While a super admin is viewing somebody's account, every request that could
    change something is refused here — before it reaches a route, a server
    action or the database. Server actions are POSTs to the page's own URL, so
    one method check covers every action in the app, including ones written
    after this line.

    Enforcing it here rather than inside each action is the entire point: a
    per-action check is a list somebody has to remember to add to, and the cost
    of forgetting once is an administrator moving a user's money. A method
    check cannot be forgotten by a new feature.

    Ending the look is a GET to /api/impersonate/stop, which this matcher does
    not cover at all — so there is no way to get stuck inside a session that
    refuses the request that would end it.
  */
  if (request.cookies.has(VIEW_AS_COOKIE)) {
    if (request.method !== 'GET') {
      return new NextResponse('Read-only while viewing as a user.', { status: 403 })
    }

    /* `en` carries no locale prefix and `fr` does, so the tail is what to
       match on — see the note in the build log about /en/… being a 307. */
    const path = request.nextUrl.pathname.replace(/^\/(en|fr)(?=\/|$)/, '')
    if (SHUT_WHILE_VIEWING.some((shut) => path.startsWith(shut))) {
      return NextResponse.redirect(new URL('/profile', request.nextUrl.origin))
    }
  }

  const response = handleI18n(request)
  await updateSession(request, response)

  /*
    THE VISITOR TOKEN HAS TO BE MINTED HERE, NOT IN THE PAGE.

    An affiliate link is `/shop/<slug>?ref=<code>`, and the page that lands on
    records the click. It first tried to set this cookie itself — and it did
    not work, silently: `cookies().set()` during a Server Component render is a
    no-op in Next.js, because the response headers are already committed by the
    time a component runs. Cookies can only be written from middleware, a route
    handler, or a server action.

    Nothing errored. The click was recorded against a token the browser never
    kept, so the next request arrived with no cookie, `attribute_order` found
    nothing, and the sale paid NOBODY. Caught by asserting on the cookie in a
    browser rather than by reading the code, which had a comment explaining how
    important the cookie was directly above the line that did not set it.

    Set on BOTH the request and the response: the request copy is what makes it
    visible to the page rendering in this same round trip, so somebody who
    clicks a link and buys immediately is still attributed.
  */
  if (request.nextUrl.searchParams.has('ref') && !request.cookies.has(VISITOR_COOKIE)) {
    const token = crypto.randomUUID()
    request.cookies.set(VISITOR_COOKIE, token)
    response.cookies.set(VISITOR_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: VISITOR_MAX_AGE,
    })
  }

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
