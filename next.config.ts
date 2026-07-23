import path from 'node:path'

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

export default withNextIntl(nextConfig)
