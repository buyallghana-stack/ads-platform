import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { CommunitiesBoard } from '@/components/admin/CommunitiesBoard'
import { getAdminCommunities } from '@/lib/admin/data/communities'

export const metadata: Metadata = {
  title: 'Admin · Communities',
  robots: { index: false, follow: false },
}

/**
 * The community links a user sees on their Profile tab.
 *
 * Content the operator authors and hands out, which is why it sits with gift
 * codes and coupons rather than under Platform settings: it is not a switch
 * that changes how the product behaves, it is a list of places to send people.
 */
export default async function AdminCommunitiesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.communities')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <CommunitiesBoard communities={await getAdminCommunities()} />
    </>
  )
}
