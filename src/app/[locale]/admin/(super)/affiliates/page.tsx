import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ArrowRight, Coins } from 'lucide-react'

import { PageHeader } from '@/components/admin/AdminChrome'
import { Link } from '@/i18n/navigation'
import { CommissionQueue } from '@/components/admin/CommissionQueue'
import { getCommissionPayouts, getCommissionTotals } from '@/lib/admin/data/affiliates'
import { getPlatformConfig } from '@/lib/admin/data/config'
import { serverNow } from '@/lib/server-now'

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

      {/* The other half, named. See the note on the payouts screen: two
          queues is the correct shape, but each one has to say so. */}
      <Link
        href="/admin/payouts"
        className="mb-4 flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3 transition-colors hover:bg-ink-50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600/12 text-brand-700">
          <Coins aria-hidden className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1 text-[0.875rem] font-medium text-ink-900">
          {t('otherQueue')}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[0.8125rem] font-medium text-brand-700">
          {t('otherQueueCta')}
          <ArrowRight aria-hidden className="size-4" />
        </span>
      </Link>

      <CommissionQueue
        initial={payouts}
        totals={totals}
        payoutsEnabled={config.values.affiliate_payouts_enabled === true}
        /* One clock for both renders, via the repo's own helper: a raw
           `Date.now()` here is what `react-hooks/purity` rejects, and
           `serverNow()` is where that reasoning is written down. */
        serverNow={serverNow()}
      />
    </>
  )
}
