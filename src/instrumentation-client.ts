import * as Sentry from '@sentry/nextjs'

import { sentryEnabled, sharedOptions } from '@/lib/observability/sentry-options'

/**
 * Browser error reporting.
 *
 * NO SESSION REPLAY AND NO TRACING — see `sentry-options.ts`. Both are the
 * heavy parts of this SDK in bytes as well as in privacy, and every kilobyte
 * here is paid for on a cheap Android over a Ghanaian mobile connection.
 *
 * Skipped entirely without a DSN, so the SDK is never initialised on a
 * deployment that has no project to report to.
 */
if (sentryEnabled()) {
  Sentry.init(sharedOptions())
}

/** Reports slow or failed client-side route changes. Cheap, and it is how a
 *  navigation that dies silently becomes visible. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
