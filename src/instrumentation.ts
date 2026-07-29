import * as Sentry from '@sentry/nextjs'

import { sentryEnabled, sharedOptions } from '@/lib/observability/sentry-options'

/**
 * Server and edge error reporting.
 *
 * Next calls `register` once per runtime at startup. Nothing is initialised
 * without a DSN, so an unset variable leaves the app exactly as it was.
 */
export async function register() {
  if (!sentryEnabled()) return

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(sharedOptions())
  }
}

/**
 * Errors thrown while rendering a request — the ones that produce a 500 for a
 * real person. Without this hook they never reach Sentry at all, which is most
 * of the value on a server-rendered app.
 */
export const onRequestError = Sentry.captureRequestError
