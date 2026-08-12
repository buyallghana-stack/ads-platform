import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { ResponsesReport } from '@/components/admin/ResponsesReport'
import { getAdResponses } from '@/lib/admin/responses-data'

export const metadata: Metadata = {
  title: 'Admin · Survey responses',
  robots: { index: false, follow: false },
}

/**
 * What people answered, and a CSV of it.
 *
 * ⚠️ UNDER `(super)` DELIBERATELY. The ad pool lives at `/admin/ads` and an ads
 * manager can reach it, because writing a survey is their job. Reading who
 * answered it is not: every row here carries a respondent's name and phone
 * number, so the folder guard and `assert_admin` inside the function both say
 * super admin. Two gates, because one of them is a URL somebody could type.
 */
export default async function AdResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ ad?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const { ad } = await searchParams
  const t = await getTranslations('admin.responses')

  const data = await getAdResponses(ad ?? null)

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ResponsesReport data={data} />
    </>
  )
}
