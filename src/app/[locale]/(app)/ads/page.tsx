import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { AdsView } from '@/components/ads/AdsView'
import { getAdsData } from '@/lib/ads/data'
import { getSessionUser } from '@/lib/auth/session'

export const metadata: Metadata = {
  title: 'Ads',
  robots: { index: false, follow: false },
}

/**
 * Ads tab — the watch-and-earn feed.
 *
 * Rendered per request rather than cached: the feed depends on what this user
 * has already completed today and on an allowance that moves as they watch.
 * The auth guard lives in (app)/layout.tsx, so a session is guaranteed by the
 * time this runs; the null check exists to narrow the type.
 */
export default async function AdsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) return null

  const data = await getAdsData(user.id)

  return <AdsView data={data} />
}
