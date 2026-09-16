import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { HubPaymentsTable } from '@/components/admin/HubPaymentsTable'
import { getHubFlags, getHubPayments } from '@/lib/admin/data/hub-payments'

export const metadata: Metadata = {
  title: 'Admin · Payments',
  robots: { index: false, follow: false },
}

/**
 * Plan payments as they came through the Tech Store hub.
 *
 * This app never talks to Paystack. It asks the hub to start a payment, and
 * the hub posts the result back over a signed channel. Everything that arrived
 * is recorded in `hub_inbound_events`, and until this screen existed none of
 * it was visible: a mismatch was refused, written down, and answered 2xx so
 * the hub would stop retrying, which is correct and completely silent.
 *
 * ⚠️ Not cached. A payments screen showing a stale answer to "did this go
 * through" is worse than no screen, because somebody acts on it.
 */
export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.payments')

  /* Both reads at once. They are independent, and a flagged event may have no
     payment behind it at all. */
  const [payments, flags] = await Promise.all([getHubPayments(), getHubFlags()])

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <HubPaymentsTable payments={payments} flags={flags} />
    </>
  )
}
