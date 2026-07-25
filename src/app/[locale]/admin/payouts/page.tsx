import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PayoutsTable } from '@/components/admin/PayoutsTable'
import { payoutRequests } from '@/lib/admin/preview'
import { DISPUTE_WINDOW_HOURS } from '@/lib/admin/types'

export const metadata: Metadata = {
  title: 'Admin · Payouts',
  robots: { index: false, follow: false },
}

export default async function AdminPayoutsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.payouts')

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description', { hours: DISPUTE_WINDOW_HOURS })}
      />
      {/* Date.now() in a Server Component is the repo's deliberate pattern for
          handing a stable clock to a client component — see dashboard/page.tsx. */}
      <PayoutsTable initial={payoutRequests()} serverNow={Date.now()} />
    </>
  )
}
