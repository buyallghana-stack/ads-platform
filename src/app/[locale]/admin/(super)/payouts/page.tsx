import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PayoutsTable } from '@/components/admin/PayoutsTable'
import { getPayoutQueue } from '@/lib/admin/data/payouts'

export const metadata: Metadata = {
  title: 'Admin · Payouts',
  robots: { index: false, follow: false },
}

/**
 * The payout queue, off preview data as of 2026-07-28.
 *
 * Nothing about the table changed to get here — `getPayoutQueue()` returns
 * the shape `preview.payoutRequests()` returned, which is what the preview
 * seam was for.
 */
export default async function AdminPayoutsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.payouts')

  const requests = await getPayoutQueue()

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
      />

      {/* Date.now() in a Server Component is the repo's deliberate pattern for
          handing a stable clock to a client component — see dashboard/page.tsx. */}
      <PayoutsTable initial={requests} serverNow={Date.now()} />
    </>
  )
}
