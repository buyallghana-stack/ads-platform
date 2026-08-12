import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { EarningsBreakdown } from '@/components/earnings/EarningsBreakdown'
import { getViewerUser } from '@/lib/auth/session'
import { getAdsBreakdown } from '@/lib/earnings/breakdown'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'earnings' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Where the money came from, on the ads side.
 *
 * `getViewerUser` rather than `getSessionUser`, so a super admin using "view
 * as" reads the account they are looking at. This page only reads, which is
 * the whole reason that is safe.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) return null

  const data = await getAdsBreakdown(user.id)
  if (!data) return null

  return <EarningsBreakdown data={data} />
}
