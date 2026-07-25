import type { Metadata } from 'next'

import { ArrowRight } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader, PersonCell, StatusDot } from '@/components/admin/AdminChrome'
import { SummaryCell, SummaryStrip } from '@/components/admin/AdminTable'
import { MetricCard } from '@/components/admin/MetricCard'
import { MoneyChart } from '@/components/admin/MoneyChart'
import { PAYOUT_TONE } from '@/components/admin/payout-status'
import { Link } from '@/i18n/navigation'
import { moneySeries, overviewMetrics, payoutRequests } from '@/lib/admin/preview'

export const metadata: Metadata = {
  title: 'Admin · Overview',
  robots: { index: false, follow: false },
}

/* Totals are rounded — nobody reads a running total to the pesewa — but a
   SINGLE transaction is shown exactly. Rounding one person's GHS 8.50 payout
   to "GHS 9" in the decision queue misstates what they are owed. */
const ghsTotal = (n: number) => `GHS ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const ghsExact = (n: number) =>
  `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Overview — the money picture, in the operator's own terms.
 *
 * Their model, stated plainly: deposits are subscriptions plus the advertiser
 * payments they key in by hand; withdrawals are what users take out; profit
 * is the difference. Those three are the top row, in that order, so the
 * arithmetic reads left to right rather than having to be assembled.
 *
 * The fourth card is the one they did not ask for and should have: points
 * people are holding but have not cashed out. It is not profit and not yet a
 * cost, but it is what the platform owes, and profit read without it looks
 * better than it is.
 *
 * MOBILE HAS NO CHART (operator direction). Below md the chart card is not
 * rendered at all — not hidden with CSS, which would still ship the markup —
 * and the screen becomes the numbers plus the queue that needs a decision.
 */
export default async function AdminOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.overview')

  const m = overviewMetrics()
  const series = moneySeries(30)
  const requests = payoutRequests()

  const queue = requests
    .filter((r) => r.status === 'pending_approval' || r.status === 'held')
    .slice(0, 5)

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      {/* ---- The three numbers, plus what we owe ---------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t('deposits')}
          value={ghsTotal(m.deposits.value)}
          comparison={t('depositsSplit', {
            subs: ghsTotal(m.deposits.subscriptions),
            ads: ghsTotal(m.deposits.advertisers),
          })}
          changePct={m.deposits.changePct}
        />
        <MetricCard
          label={t('withdrawals')}
          value={ghsTotal(m.withdrawals.value)}
          comparison={t('withdrawalsHint')}
          changePct={m.withdrawals.changePct}
          // More money leaving is not a win, even though the arrow points up.
          positiveIsGood={false}
        />
        <MetricCard
          label={t('profit')}
          value={ghsTotal(m.profit.value)}
          comparison={t('profitHint')}
          changePct={m.profit.changePct}
        />
        <MetricCard
          label={t('liability')}
          value={ghsTotal(m.liability.ghs)}
          comparison={t('liabilityHint', { points: m.liability.points.toLocaleString() })}
        />
      </div>

      {/* ---- Second row: the operating picture -------------------------
          Deliberately NOT four more cards. The money above is what the
          operator is accountable for; this is context — how many people, how
          many plans, how much work is queued, how much is playing. Giving it
          the same weight as the money made the overview eight equal boxes
          with no answer to "what do I look at first". A hairline strip says
          "these are related, and they are smaller than the row above" without
          a word of explanation. */}
      <SummaryStrip cols={4} className="mt-3">
        <SummaryCell
          label={t('users')}
          value={m.users.value.toLocaleString()}
          detail={t('usersToday', { count: m.users.newToday })}
        />
        <SummaryCell
          label={t('subscriptions')}
          value={m.subscriptions.active.toLocaleString()}
          detail={t('subscriptionsHint')}
        />
        <SummaryCell
          label={t('pending')}
          value={m.pendingPayouts.count.toLocaleString()}
          detail={ghsTotal(m.pendingPayouts.ghs)}
          emphasis={m.pendingPayouts.count > 0}
        />
        <SummaryCell
          label={t('adsLive')}
          value={m.adsLive.total.toLocaleString()}
          detail={t('adsSplit', { videos: m.adsLive.videos, surveys: m.adsLive.surveys })}
        />
      </SummaryStrip>

      {/* ---- Chart + queue --------------------------------------------
          The chart is md-and-up only, per the operator. On a phone the
          screen goes straight from the numbers to the decisions. */}
      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <div className="hidden rounded-(--radius-card) border border-ink-200 bg-surface md:block xl:col-span-2">
          <MoneyChart data={series} />
        </div>

        <section className="rounded-(--radius-card) border border-ink-200 bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.01em] text-ink-900">
                {t('queue.title')}
              </h2>
              <p className="mt-0.5 text-[0.75rem] text-ink-500">{t('queue.subtitle')}</p>
            </div>
            <Link
              href="/admin/payouts"
              className="inline-flex shrink-0 items-center gap-1 text-[0.75rem] font-medium text-brand-700 hover:underline"
            >
              {t('queue.all')}
              <ArrowRight aria-hidden className="size-3" />
            </Link>
          </div>

          {queue.length === 0 ? (
            <p className="px-4 py-10 text-center text-[0.8125rem] text-ink-400">
              {t('queue.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-ink-200/70">
              {queue.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <PersonCell name={r.user.name} secondary={r.reference} />
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                      {ghsExact(r.ghs)}
                    </p>
                    <StatusDot tone={PAYOUT_TONE[r.status]} className="mt-1">
                      {t(`status.${r.status}`)}
                    </StatusDot>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
