import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { AdvertisersBoard } from '@/components/admin/AdvertisersBoard'
import { getAdvertisers } from '@/lib/admin/data/advertisers'

export const metadata: Metadata = {
  title: 'Admin · Advertisers',
  robots: { index: false, follow: false },
}

/**
 * Advertisers — who is paying, and how much of it has been delivered.
 *
 * REAL AS OF 2026-07-29 (migration 055). Until then this screen had no backend
 * at all: `ads.advertiser_name` was a free-text reporting label and there was
 * nowhere for a contract or a receipt to exist. That is also why Overview and
 * Finance were showing invented deposits — the figure is defined as
 * subscriptions plus advertiser contracts, and one of those two had no home.
 *
 * The layout and the reasoning behind it live in AdvertisersBoard.
 */
export default async function AdminAdvertisersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.advertisers')

  const advertisers = await getAdvertisers()

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {/* Date.now() in a Server Component is the repo's deliberate pattern for
          handing a stable clock to a client component — see payouts/page.tsx. */}
      <AdvertisersBoard initial={advertisers} serverNow={Date.now()} />
    </>
  )
}
