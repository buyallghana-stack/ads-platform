import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { CommissionQueue } from '@/components/admin/CommissionQueue'
import { getCommissionPayouts, getCommissionTotals } from '@/lib/admin/data/affiliates'
import { getPlatformConfig } from '@/lib/admin/data/config'

export const metadata: Metadata = {
  title: 'Admin · Affiliates',
  robots: { index: false, follow: false },
}

/**
 * The commission withdrawal queue.
 *
 * The affiliate business's front screen is the thing that WAITS on the
 * operator, exactly as Payouts is for points — the roster of affiliates is a
 * view of people, nothing there is blocked on a decision, so it sits one click
 * behind rather than beside.
 *
 * ⚠️ THIS SCREEN MUST STAY UNDER `(super)/`. The read functions it uses are
 * `security definer` and do NOT re-check the caller's role; they are granted
 * to `service_role` alone and it is this route group that decides who may ask.
 * Moving the folder moves the guard — see `lib/admin/data/affiliates.ts`.
 */
export default async function AdminAffiliatesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.affiliates')

  const [payouts, totals, config] = await Promise.all([
    getCommissionPayouts(),
    getCommissionTotals(),
    getPlatformConfig(),
  ])

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <CommissionQueue
        initial={payouts}
        totals={totals}
        payoutsEnabled={config.values.affiliate_payouts_enabled === true}
        /* One clock for both renders. `Date.now()` in a Server Component is
           this repo's pattern for handing a stable now to a client one — the
           alternative is a hydration error over "3 hours ago". */
        serverNow={Date.now()}
      />
    </>
  )
}
