import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { Planned, PlannedNote } from '@/components/admin/Planned'

export const metadata: Metadata = {
  title: 'Admin · Advertisers',
  robots: { index: false, follow: false },
}

/**
 * Advertisers — screen not built yet, scope written down.
 *
 * Listed rather than hidden so the operator can point at a line and say
 * "build that next", the way the Profile hub was worked through.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.advertisers')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PlannedNote ready={false}>{t('note')}</PlannedNote>
      <Planned
        items={[
          { title: 'Advertiser records', body: 'Name, contact, and the ads placed against them.' },
          { title: 'Manual payment entry', body: 'Key in what an advertiser paid and when. This is what feeds the deposits total, so each entry needs a date, an amount and a reference.' },
          { title: 'Contract to ads', body: 'Link a payment to the ads it bought, so cost per completion can be read back.' },
          { title: 'Statement', body: 'What each advertiser has paid, spent in completions, and has left.' },
          { title: 'Receipts', body: 'Attach proof of a transfer to a payment entry.' },
        ]}
      />
    </>
  )
}
