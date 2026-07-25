import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { SummaryCell, SummaryStrip } from '@/components/admin/AdminTable'
import { financeRows, overviewMetrics } from '@/lib/admin/preview'

export const metadata: Metadata = {
  title: 'Admin · Finance',
  robots: { index: false, follow: false },
}

const ghs = (n: number) => `GHS ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

/**
 * Finance — the statement, with the working shown.
 *
 * The operator's model is deliberately simple and this screen refuses to make
 * it look more complicated than it is: money in is plan purchases plus
 * advertiser contracts, money out is what users withdrew, profit is the
 * difference. So the table is those four columns per month and nothing else,
 * and every row's profit is visibly its own row's arithmetic rather than a
 * figure from somewhere the operator cannot check.
 *
 * The one number that is NOT in the table is the one that matters most and is
 * easiest to forget: points people are holding but have not cashed out. It is
 * not a cost yet, so it does not belong in a monthly profit line — but profit
 * read without it looks better than it is, so it sits above the table where
 * it cannot be missed.
 *
 * Server-rendered. There is nothing here to interact with yet, and shipping a
 * client bundle for a static table would be a cost with no return.
 */
export default async function AdminFinancePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.finance')

  const rows = financeRows()
  const m = overviewMetrics()

  const totals = rows.reduce(
    (acc, r) => ({
      subscriptions: acc.subscriptions + r.subscriptionsGhs,
      advertisers: acc.advertisers + r.advertisersGhs,
      withdrawals: acc.withdrawals + r.withdrawalsGhs,
    }),
    { subscriptions: 0, advertisers: 0, withdrawals: 0 },
  )
  const totalIn = totals.subscriptions + totals.advertisers
  const totalProfit = totalIn - totals.withdrawals

  const monthLabel = (iso: string) =>
    new Date(`${iso}-01T00:00:00Z`).toLocaleDateString(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <SummaryStrip className="mb-5">
        <SummaryCell label={t('summary.in')} value={ghs(totalIn)} detail={t('summary.period')} />
        <SummaryCell
          label={t('summary.out')}
          value={ghs(totals.withdrawals)}
          detail={t('summary.period')}
        />
        <SummaryCell
          label={t('summary.profit')}
          value={ghs(totalProfit)}
          detail={t('summary.period')}
        />
      </SummaryStrip>

      {/* The liability, said out loud, above the profit it qualifies. */}
      <div className="mb-5 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 px-4 py-3.5">
        <p className="text-[0.75rem] font-semibold text-warning-600">{t('liability.label')}</p>
        <p className="mt-1 text-[1.375rem] leading-none font-semibold text-warning-600 tabular-nums">
          {ghs(m.liability.ghs)}
        </p>
        <p className="mt-1.5 max-w-[70ch] text-[0.75rem] leading-relaxed text-warning-600/90">
          {t('liability.body', { points: m.liability.points.toLocaleString() })}
        </p>
      </div>

      {/* ---- Statement, lg and up --------------------------------------
          Below lg this becomes cards. A six-column money table on a 390px
          screen is not a table with a scrollbar, it is a table cut off
          mid-figure — the numbers wrapped to "GHS / 21,750" and the profit
          column, the one the screen exists for, fell off the right edge. */}
      <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-ink-200">
              {(['month', 'subscriptions', 'advertisers', 'in', 'out', 'profit'] as const).map(
                (c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={`px-4 py-2.5 text-[0.6875rem] font-medium tracking-[0.04em] text-ink-400 uppercase ${
                      i === 0 ? 'text-left' : 'text-right'
                    }`}
                  >
                    {t(`columns.${c}`)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200">
            {rows.map((r) => {
              const inTotal = r.subscriptionsGhs + r.advertisersGhs
              const profit = inTotal - r.withdrawalsGhs
              return (
                <tr key={r.month} className="hover:bg-ink-50/60">
                  <td className="px-4 py-3 text-[0.8125rem] font-medium text-ink-900">
                    {monthLabel(r.month)}
                  </td>
                  <td className="px-4 py-3 text-right text-[0.8125rem] text-ink-600 tabular-nums">
                    {ghs(r.subscriptionsGhs)}
                  </td>
                  <td className="px-4 py-3 text-right text-[0.8125rem] text-ink-600 tabular-nums">
                    {ghs(r.advertisersGhs)}
                  </td>
                  <td className="px-4 py-3 text-right text-[0.8125rem] font-medium text-success-700 tabular-nums">
                    {ghs(inTotal)}
                  </td>
                  <td className="px-4 py-3 text-right text-[0.8125rem] font-medium text-brand-700 tabular-nums">
                    {ghs(r.withdrawalsGhs)}
                  </td>
                  <td className="px-4 py-3 text-right text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                    {ghs(profit)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink-300 bg-ink-50/60">
              <td className="px-4 py-3 text-[0.8125rem] font-semibold text-ink-900">
                {t('columns.total')}
              </td>
              <td className="px-4 py-3 text-right text-[0.8125rem] font-medium text-ink-700 tabular-nums">
                {ghs(totals.subscriptions)}
              </td>
              <td className="px-4 py-3 text-right text-[0.8125rem] font-medium text-ink-700 tabular-nums">
                {ghs(totals.advertisers)}
              </td>
              <td className="px-4 py-3 text-right text-[0.8125rem] font-semibold text-success-700 tabular-nums">
                {ghs(totalIn)}
              </td>
              <td className="px-4 py-3 text-right text-[0.8125rem] font-semibold text-brand-700 tabular-nums">
                {ghs(totals.withdrawals)}
              </td>
              <td className="px-4 py-3 text-right text-[0.8125rem] font-bold text-ink-900 tabular-nums">
                {ghs(totalProfit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ---- Statement, below lg ---------------------------------------
          One card per month, the two inputs on top and the profit on its own
          line underneath — so the arithmetic still reads top to bottom. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {[...rows]
          .map((r) => ({
            ...r,
            inTotal: r.subscriptionsGhs + r.advertisersGhs,
          }))
          .map((r) => (
            <li
              key={r.month}
              className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
            >
              <p className="text-[0.875rem] font-semibold text-ink-900">{monthLabel(r.month)}</p>

              <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-ink-200 pt-2.5">
                <div>
                  <dt className="text-[0.6875rem] text-ink-400">{t('columns.subscriptions')}</dt>
                  <dd className="mt-0.5 text-[0.8125rem] text-ink-700 tabular-nums">
                    {ghs(r.subscriptionsGhs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.6875rem] text-ink-400">{t('columns.advertisers')}</dt>
                  <dd className="mt-0.5 text-[0.8125rem] text-ink-700 tabular-nums">
                    {ghs(r.advertisersGhs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.6875rem] text-ink-400">{t('columns.in')}</dt>
                  <dd className="mt-0.5 text-[0.8125rem] font-medium text-success-700 tabular-nums">
                    {ghs(r.inTotal)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.6875rem] text-ink-400">{t('columns.out')}</dt>
                  <dd className="mt-0.5 text-[0.8125rem] font-medium text-brand-700 tabular-nums">
                    {ghs(r.withdrawalsGhs)}
                  </dd>
                </div>
              </dl>

              <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-ink-200 pt-2.5">
                <span className="text-[0.75rem] font-medium text-ink-500">
                  {t('columns.profit')}
                </span>
                <span className="text-[1rem] font-semibold text-ink-900 tabular-nums">
                  {ghs(r.inTotal - r.withdrawalsGhs)}
                </span>
              </div>
            </li>
          ))}

        <li className="rounded-(--radius-card) border border-ink-300 bg-ink-50 p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.8125rem] font-semibold text-ink-900">
              {t('columns.total')}
            </span>
            <span className="text-[1.125rem] font-bold text-ink-900 tabular-nums">
              {ghs(totalProfit)}
            </span>
          </div>
          <p className="mt-1 text-[0.6875rem] text-ink-500 tabular-nums">
            {ghs(totalIn)} {t('columns.in').toLowerCase()} · {ghs(totals.withdrawals)}{' '}
            {t('columns.out').toLowerCase()}
          </p>
        </li>
      </ul>

      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-400">{t('exportNote')}</p>
    </>
  )
}
