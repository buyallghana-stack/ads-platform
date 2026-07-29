import type { ErrorEvent } from '@sentry/nextjs'

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
 *   · `includeLocalVariables` is NOT set on the server. It attaches local
 *     variable values to every stack frame, and the locals on the paths worth
 *     instrumenting here are a withdrawal PIN, a session token and somebody's
 *     MSISDN.
 *   · `enableLogs` is off. The ask was to find out when things break, not to
 *     ship a second logging product.
 *
 * Tracing IS on, at Sentry's own recommended baseline — see below. It is the
 * one default worth taking as written.
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
 * Sentry's own scrubbing works on keys it recognises; this works on the three
 * places this app's secrets actually appear.
 */
function beforeSend(event: ErrorEvent): ErrorEvent | null {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url)

  /*
    SERVER ACTION ARGUMENTS. Sentry captures them as the request body, and
    `sendDefaultPii: false` does NOT cover it — found by reading a real event
    from the live project, which carried a signup's email address and phone
    number in clear. Its own denylist had filtered `password` and
    `turnstileToken` by NAME and nothing else.

    That is unacceptable in this application specifically, because the
    arguments to these actions are a withdrawal PIN, a mobile-money number, a
    crypto wallet address and the text of somebody's support message.

    Redacting by key NAME was rejected outright: that is a denylist, and a
    denylist is exactly what just failed. Everything goes.

    In practice the whole body collapses to a single "[redacted]" string,
    because a server action's payload arrives here as one encoded string and is
    only parsed into fields later, by Sentry's own UI. Verified against a real
    event. The recursion below still matters for the shapes that do arrive
    structured — and losing the body entirely is the right trade on a money
    path anyway: the stack trace says which action failed, which is the part
    worth having.
  */
  if (event.request && 'data' in event.request) {
    event.request.data = redactValues(event.request.data)
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) =>
      typeof crumb.data?.url === 'string'
        ? { ...crumb, data: { ...crumb.data, url: scrubUrl(crumb.data.url) } }
        : crumb,
    )
  }

  return event
}

/**
 * Keeps the shape, drops the content. Recurses so a nested object in an
 * action's arguments cannot smuggle a value out inside it.
 */
function redactValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValues)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactValues(v)]),
    )
  }
  // Scalars are the payload. Null stays null so an absent field still reads as
  // absent rather than as something withheld.
  return value === null || value === undefined ? value : '[redacted]'
}

export function sharedOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: environment(),

    /*
      `sendDefaultPii: false` is the SDK default, stated explicitly so turning
      it on has to be somebody's decision.

      DO NOT REPLACE THIS WITH A `dataCollection` OBJECT. Sentry only falls back
      to `sendDefaultPii` while `dataCollection` is ABSENT — passing it at all,
      even as `{}`, flips every unset category to its permissive default. An
      empty object here would quietly start sending cookies and headers.
    */
    sendDefaultPii: false,

    /*
      Tracing at Sentry's recommended baseline: everything in development, a
      tenth of production traffic. Enough to see which route or query is slow
      without sampling every request a user makes or burning the quota.
    */
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1 : 0.1,

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
