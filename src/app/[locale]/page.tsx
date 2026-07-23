import { setRequestLocale } from 'next-intl/server'

import { redirect } from '@/i18n/navigation'

/**
 * Root.
 *
 * Sends visitors to sign-up. There is no marketing landing page yet, and
 * leaving the framework's starter page at the front door of a deployed
 * product is worse than a redirect — which is exactly what the deployed URL
 * was showing.
 *
 * This becomes a real branch once auth is wired: signed in goes to the
 * dashboard, signed out goes to a landing page or straight to log in. The
 * locale-aware redirect keeps a French visitor under /fr.
 */
export default async function RootPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  redirect({ href: '/signup', locale })
}
