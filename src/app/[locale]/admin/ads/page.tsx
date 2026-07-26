import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { AdsTable } from '@/components/admin/AdsTable'
import { getAdsScreenData } from '@/lib/admin/ads-data'

export const metadata: Metadata = {
  title: 'Admin · Ads & surveys',
  robots: { index: false, follow: false },
}

/** Real data, not preview: this screen writes to the pool users are served. */
export default async function AdminAdsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.ads')

  const data = await getAdsScreenData()

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AdsTable ads={data.ads} pointsPerGhs={data.pointsPerGhs} serverNow={data.now} />
    </>
  )
}
