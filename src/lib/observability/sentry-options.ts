import type { ErrorEvent, EventHint } from '@sentry/nextjs'

/**
 * The settings every Sentry entry point shares, in one place so the browser,
 * the server and the edge runtime cannot drift apart on anything that matters.
 *
 * INERT WITHOUT A DSN, and that is the whole design — the same rule as the
 * Turnstile keys. `sentryEnabled()` is false when the variable is unset, every
 * init is skipped, and the app behaves exactly as it did before this existed.
 * A monitoring tool must never be the reason a deploy fails.
 *
 * WHY SO MUCH OF THIS IS TURNED DOWN. This is a money platform, and the
 * default posture of an error tracker — capture everything, ask later — is the
 * wrong one here:
 *
 *   · `sendDefaultPii` stays FALSE. With it on, Sentry attaches IP addresses,
 *     cookies and headers to every event. The cookie on any signed-in request
 *     IS the session.
 *   · SESSION REPLAY IS NOT INSTALLED AT ALL. It records the DOM, and the DOM
 *     here is somebody's balance, their MSISDN and their payout history. There
 *     is no masking setting that makes recording a money screen a good trade.
 *   · Tracing is off. It is a performance product, it samples real user
 *     requests, and nobody is going to read it. Errors are what was missing.
 */

export function sentryEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN)
}

/**
 * Which deployment an event came from, so a preview's noise never gets mistaken
 * for production. `VERCEL_ENV` is production | preview | development.
 */
function environment(): string {
  return process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? 'development'
}

/**
 * Query parameters that are credentials.
 *
 * `/auth/confirm?token_hash=…` is a single-use sign-in link: an error thrown
 * anywhere near it would otherwise post that token to a third party, and the
 * whole point of a magic link is that possession is proof. `code` and
 * `access_token` are the OAuth-shaped equivalents.
 */
const SECRET_PARAMS = ['token_hash', 'access_token', 'refresh_token', 'code', 'token']

function scrubUrl(value: string): string {
  try {
    const url = new URL(value)
    let touched = false
    for (const key of SECRET_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '[redacted]')
        touched = true
      }
    }
    return touched ? url.toString() : value
  } catch {
    // Not a URL. Left alone rather than guessed at.
    return value
  }
}

/**
 * Last gate before an event leaves the machine.
 *
 * Sentry's own scrubbing works on keys it recognises; this works on the two
 * places a token actually appears in this app — the request URL and the
 * breadcrumb trail that led there.
 */
function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url)

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) =>
      typeof crumb.data?.url === 'string'
        ? { ...crumb, data: { ...crumb.data, url: scrubUrl(crumb.data.url) } }
        : crumb,
    )
  }

  return event
}

export function sharedOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: environment(),

    // See the note above. Both are the SDK defaults; stated explicitly so
    // turning either on has to be a decision somebody makes on purpose.
    sendDefaultPii: false,
    tracesSampleRate: 0,

    /*
      Errors we can neither fix nor act on. A tracker that cries about a user's
      browser extension teaches its owner to ignore it, and an ignored tracker
      is worse than none — it is the same failure as a badge with nothing
      behind it.
    */
    ignoreErrors: [
      // Benign, fires when a ResizeObserver callback outlives a frame.
      'ResizeObserver loop completed with undelivered notifications',
      'ResizeObserver loop limit exceeded',
      // The user navigated away mid-request, or the phone lost signal — which
      // on a Ghanaian mobile connection is ordinary, not an incident.
      'AbortError',
      'NetworkError when attempting to fetch resource',
      'Failed to fetch',
      // Browser extensions and embedded webviews injecting their own scripts.
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
    ],

    beforeSend,
  }
}
