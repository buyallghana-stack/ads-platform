import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { AdsTable } from '@/components/admin/AdsTable'
import { adItems } from '@/lib/admin/preview'

export const metadata: Metadata = {
  title: 'Admin · Ads & surveys',
  robots: { index: false, follow: false },
}

export default async function AdminAdsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.ads')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {/* Date.now() in a Server Component is the repo's deliberate pattern for
          handing a stable clock to a client component — see payouts/page.tsx. */}
      <AdsTable initial={adItems()} serverNow={Date.now()} />
    </>
  )
}
