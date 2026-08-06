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

  /*
    Product covers come from Supabase Storage's public bucket, and next/image
    refuses a remote host it was not told about — a deliberate default, so that
    an attacker cannot point the optimiser at arbitrary URLs and use it as a
    proxy.

    Pinned to the project's own storage path rather than the whole hostname:
    `/storage/v1/object/public/**` is the only prefix that serves public
    objects, so a private bucket URL cannot be optimised even if one leaked
    into a src attribute.
  */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: new URL(
          process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
        ).hostname,
        pathname: '/storage/v1/object/public/**',
      },
    ],
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

  /*
    Uploads a wider set of client files, which is what makes a browser stack
    trace resolve to our source instead of stopping at a framework frame. The
    reference calls for it and the cost is build time, not runtime bytes.
  */
  widenClientFileUpload: true,

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

  /*
    NO `disableLogger` OR `automaticVercelMonitors` HERE. Both are deprecated
    in favour of `webpack.*` equivalents, and this project builds with
    TURBOPACK, where the webpack tree-shaking options do nothing at all. They
    were set, did nothing, and printed a deprecation warning on every build —
    so they are gone rather than left as decoration.

    The practical consequence: the SDK's own debug logging stays in the browser
    bundle. That is part of the 63 KB measured, and it is not removable while
    the build is Turbopack.
  */
})
