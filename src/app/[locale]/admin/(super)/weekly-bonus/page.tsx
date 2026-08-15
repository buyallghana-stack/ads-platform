import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { WeeklyBonusCampaigns } from '@/components/admin/WeeklyBonusCampaigns'
import { getAdminWeeklyBonusCampaigns } from '@/lib/admin/data/weekly-bonus'

export const metadata: Metadata = {
  title: 'Admin · Weekly Bonus',
  robots: { index: false, follow: false },
}

export default async function AdminWeeklyBonusPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.weeklyBonus')
  const campaigns = await getAdminWeeklyBonusCampaigns()

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <WeeklyBonusCampaigns campaigns={campaigns} />
    </>
  )
}
