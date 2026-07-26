import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PlansTable } from '@/components/admin/PlansTable'
import { plans } from '@/lib/admin/preview'

export const metadata: Metadata = {
  title: 'Admin · Subscriptions',
  robots: { index: false, follow: false },
}

export default async function AdminSubscriptionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.subscriptions')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PlansTable initial={plans()} />
    </>
  )
}
