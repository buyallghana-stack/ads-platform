import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { AffiliateRoster } from '@/components/admin/AffiliateRoster'
import { Link } from '@/i18n/navigation'
import { getAffiliates } from '@/lib/admin/data/affiliates'

export const metadata: Metadata = {
  title: 'Admin · Affiliates · People',
  robots: { index: false, follow: false },
}

/**
 * Everybody selling, and whether they may go on.
 *
 * Behind the queue rather than beside it in the nav: the sidebar is already
 * fifteen destinations, and nothing on this screen waits on the operator. The
 * way in is the button on the queue's toolbar, and the nav keeps Affiliates
 * lit because it matches by route prefix.
 */
export default async function AdminAffiliatePeoplePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.affiliates')

  const affiliates = await getAffiliates()

  return (
    <>
      <Link
        href="/admin/affiliates"
        className="mb-3 inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('people.back')}
      </Link>
      <PageHeader title={t('people.title')} description={t('people.description')} />
      <AffiliateRoster initial={affiliates} />
    </>
  )
}
