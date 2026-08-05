import { setRequestLocale } from 'next-intl/server'

import { MarketDashboard } from '@/components/market/MarketDashboard'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateDashboard } from '@/lib/market/data'

/**
 * Market mode's home.
 *
 * `getViewerUser` rather than `getSessionUser`, matching the app layout: when
 * a super admin is looking at somebody's account, this screen shows THAT
 * account's affiliate standing. The look is read-only — middleware refuses
 * every non-GET while the viewing cookie is set — so nothing here can act.
 */
export default async function MarketPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const data = await getAffiliateDashboard(user!.id)
  return <MarketDashboard data={data} />
}
