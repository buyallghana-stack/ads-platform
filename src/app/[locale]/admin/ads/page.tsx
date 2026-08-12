import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AdBuckets } from '@/components/admin/AdBuckets'
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
      {/* Above the pool, not inside it: whether today is covered is the first
          question this screen has to answer, and the table cannot answer it. */}
      <AdBuckets ads={data.ads} tiers={data.tiers} serverNow={data.now} />
      <AdsTable ads={data.ads} pointsPerGhs={data.pointsPerGhs} serverNow={data.now} />
    </>
  )
}
