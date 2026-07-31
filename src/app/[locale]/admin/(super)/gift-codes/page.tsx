import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { GiftCodesBoard } from '@/components/admin/GiftCodesBoard'
import { getGiftCodes } from '@/lib/admin/data/gift-codes'

export const metadata: Metadata = {
  title: 'Admin · Gift codes',
  robots: { index: false, follow: false },
}

/**
 * Gift codes: generate one, attach points, revoke an unused one.
 *
 * Real data, not preview — `REAL_ADMIN_SECTIONS` in AdminChrome carries the
 * badge for this route.
 *
 * The admin guard is in `admin/layout.tsx`, and `admin_list_gift_codes`
 * re-checks `is_admin()` itself, so this page needs no guard of its own.
 */
export default async function AdminGiftCodesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.giftCodes')

  const codes = await getGiftCodes()

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <GiftCodesBoard codes={codes} />
    </>
  )
}
