import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { CommissionGiftCodesBoard } from '@/components/admin/CommissionGiftCodesBoard'
import { GiftCodesBoard } from '@/components/admin/GiftCodesBoard'
import { getCommissionGiftCodes, getGiftCodes } from '@/lib/admin/data/gift-codes'

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

  const [codes, commissionCodes] = await Promise.all([getGiftCodes(), getCommissionGiftCodes()])

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      {/*
        TWO BOARDS, BOTH VISIBLE, EACH NAMING ITS MONEY.

        The operator came here looking for the affiliate gift code and found
        only this one (2026-08-07). Stacked rather than behind a tab strip on
        purpose: a tab would hide the other half again, which is the exact
        problem, and each board carries a create form that a tab switch would
        throw away half-filled.

        They read separate tables through separate functions. Nothing is shared
        but the page they sit on.
      */}
      <section aria-labelledby="gift-points">
        <h2
          id="gift-points"
          className="mb-3 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900"
        >
          {t('sectionPoints')}
        </h2>
        <GiftCodesBoard codes={codes} />
      </section>

      <section aria-labelledby="gift-commission" className="mt-10">
        <h2
          id="gift-commission"
          className="mb-3 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900"
        >
          {t('sectionCommission')}
        </h2>
        <CommissionGiftCodesBoard codes={commissionCodes} />
      </section>
    </>
  )
}
