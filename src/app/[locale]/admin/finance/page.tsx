import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { Planned, PlannedNote } from '@/components/admin/Planned'

export const metadata: Metadata = {
  title: 'Admin · Finance',
  robots: { index: false, follow: false },
}

/**
 * Finance — screen not built yet, scope written down.
 *
 * Listed rather than hidden so the operator can point at a line and say
 * "build that next", the way the Profile hub was worked through.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.finance')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PlannedNote ready={false}>{t('note')}</PlannedNote>
      <Planned
        items={[
          { title: 'Deposits breakdown', body: 'Subscriptions against advertiser payments, by month.', backend: 'subscription_payments' },
          { title: 'Withdrawals breakdown', body: 'Paid redemptions by method, with fees when they exist.', backend: 'redemptions' },
          { title: 'Profit statement', body: 'Deposits minus withdrawals over a period, with the working shown.' },
          { title: 'Points liability', body: 'Outstanding balances valued at the current rate — what is owed if everyone cashed out.', backend: 'user_balances' },
          { title: 'Daily issuance', body: 'Points minted per day against the reward-pool ceiling.', backend: 'daily_issuance' },
          { title: 'Export', body: 'CSV of any statement, for the accountant.' },
        ]}
      />
    </>
  )
}
