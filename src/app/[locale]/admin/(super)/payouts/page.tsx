import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ArrowRight, Store } from 'lucide-react'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PayoutsTable } from '@/components/admin/PayoutsTable'
import { Link } from '@/i18n/navigation'
import { countCommissionPayoutsAwaitingDecision } from '@/lib/admin/data/affiliates'
import { getPayoutQueue } from '@/lib/admin/data/payouts'

export const metadata: Metadata = {
  title: 'Admin · Payouts',
  robots: { index: false, follow: false },
}

/**
 * The payout queue, off preview data as of 2026-07-28.
 *
 * Nothing about the table changed to get here — `getPayoutQueue()` returns
 * the shape `preview.payoutRequests()` returned, which is what the preview
 * seam was for.
 */
export default async function AdminPayoutsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.payouts')

  const [requests, commissionWaiting] = await Promise.all([
    getPayoutQueue(),
    countCommissionPayoutsAwaitingDecision(),
  ])

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
      />
      {/*
        ⚠️ THE OTHER QUEUE, SIGNPOSTED (operator, 2026-08-07: withdrawals
        "should be able to be distinguished at the admin panel").

        They are distinguished by being two queues, and that is the right
        answer — different money, different balance, different ledger, and D27
        says the two businesses share no table and no function. What was
        missing is that this screen is the one somebody opens looking for "the
        withdrawals", and it said nothing about the other half existing. Both
        titles now name their money, and this points across with a live count
        so a waiting affiliate is not invisible from here.

        A link, deliberately, not a merged table: merging them is exactly the
        mixing that would put a points figure and a cedis figure in one column.
      */}
      <Link
        href="/admin/affiliates"
        className="mb-4 flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3 transition-colors hover:bg-ink-50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-violet-500/12 text-violet-600">
          <Store aria-hidden className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.875rem] font-medium text-ink-900">{t('otherQueue')}</span>
          <span className="block text-[0.75rem] text-ink-500">
            {t('otherQueueWaiting', { n: commissionWaiting })}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[0.8125rem] font-medium text-brand-700">
          {t('otherQueueCta')}
          <ArrowRight aria-hidden className="size-4" />
        </span>
      </Link>

      {/* Date.now() in a Server Component is the repo's deliberate pattern for
          handing a stable clock to a client component — see dashboard/page.tsx. */}
      <PayoutsTable initial={requests} serverNow={Date.now()} />
    </>
  )
}
