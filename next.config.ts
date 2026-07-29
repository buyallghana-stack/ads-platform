import path from 'node:path'

import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  turbopack: {
    // Pinned explicitly. pnpm-workspace.yaml in the project root makes Turbopack
    // infer a monorepo and pick the wrong root, which crashed the dev server
    // with "We couldn't find the Next.js package from the project directory".
    root: path.resolve(__dirname),
  },

  // Fail the production build on type errors rather than shipping them. It is
  // the default already; stated explicitly so turning it off has to be
  // deliberate. (Next 16 removed the equivalent `eslint` key — linting runs
  // through `pnpm lint` in CI instead.)
  typescript: { ignoreBuildErrors: false },
}

export default withSentryConfig(withNextIntl(nextConfig), {
  /*
    Source map upload. Without an auth token the SDK skips it and the build
    still succeeds — deliberate, so a missing secret can never break a deploy.
    The cost of skipping is that stack traces stay minified, which is most of
    the reason to have this at all, so the token is worth setting.
  */
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: !process.env.CI,

  /*
    Sends events through our own domain instead of straight to Sentry.

    Worth the extra function invocation here specifically: ad blockers on cheap
    Android browsers routinely block requests to sentry.io outright, and the
    errors most worth seeing are the ones happening on exactly those devices.
    Without this they would be dropped silently and the dashboard would look
    reassuringly quiet.
  */
  tunnelRoute: '/monitoring',

  // Strips the SDK's own debug logging from the browser bundle.
  disableLogger: true,

  /*
    The SDK would otherwise instrument Vercel's cron invocations. There is
    exactly one cron here (the deletion purge) and it already fails loudly, so
    this keeps the check-in quota for something that needs it.
  */
  automaticVercelMonitors: false,
})
