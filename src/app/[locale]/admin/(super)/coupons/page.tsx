import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { CouponsBoard } from '@/components/admin/CouponsBoard'
import { getCoupons, getCouponTargets } from '@/lib/admin/data/coupons'

export const metadata: Metadata = {
  title: 'Admin · Coupons',
  robots: { index: false, follow: false },
}

/**
 * Coupon codes, both businesses on one screen.
 *
 * ONE BOARD, NOT TWO, unlike the gift codes next door. That page carries two
 * because the two kinds of gift code pay out different money: one mints points
 * and the other pays cedis, and a single form taking a "business" argument is
 * one missed branch away from creating a GHS 500 voucher where somebody meant
 * 500 points. A coupon never pays anything out. It reduces a price, in cedis,
 * in both businesses, so the shape is genuinely the same and the target picker
 * is the only thing that changes.
 *
 * The admin guard is in `admin/layout.tsx`, and every function behind this
 * screen asserts on the acting admin id it is given.
 */
export default async function AdminCouponsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.coupons')

  const [coupons, targets] = await Promise.all([getCoupons(), getCouponTargets()])

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <CouponsBoard coupons={coupons} targets={targets} />
    </>
  )
}
