import type { Metadata } from 'next'

import { TrendingDown, TrendingUp } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader, StatusDot } from '@/components/admin/AdminChrome'
import { SummaryCell, SummaryStrip } from '@/components/admin/AdminTable'
import { plans } from '@/lib/admin/preview'

export const metadata: Metadata = {
  title: 'Admin · Subscriptions',
  robots: { index: false, follow: false },
}

const ghs = (n: number) => `GHS ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

/**
 * Subscriptions — the plans, and whether they are actually selling.
 *
 * The column that justifies the screen is the last one: revenue per plan
 * against what that plan costs the platform in extra earning. A Platinum
 * subscriber pays GHS 200 and earns at 3× with twenty extra ads a day — the
 * plan is only worth selling if the first number stays ahead of the second,
 * and no other screen puts them side by side.
 *
 * Free is listed with the paid plans on purpose. It is the denominator: 2,423
 * people on Free against 418 paying is the conversion rate, and hiding the
 * free tier would make the paid numbers look like the whole platform.
 *
 * Server-rendered — plan definitions are edited in Platform settings, so
 * there is nothing to interact with here.
 */
export default async function AdminSubscriptionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.subscriptions')

  const rows = plans()
  const paid = rows.filter((p) => p.priceGhs > 0)
  const activePaid = paid.reduce((n, p) => n + p.active, 0)
  const monthly = paid.reduce((n, p) => n + p.monthlyGhs, 0)
  const everyone = rows.reduce((n, p) => n + p.active, 0)
  const conversion = everyone === 0 ? 0 : Math.round((activePaid / everyone) * 1000) / 10

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <SummaryStrip className="mb-5">
        <SummaryCell
          label={t('summary.paying')}
          value={activePaid.toLocaleString()}
          detail={t('summary.payingHint', { total: everyone.toLocaleString() })}
        />
        <SummaryCell
          label={t('summary.monthly')}
          value={ghs(monthly)}
          detail={t('summary.monthlyHint')}
        />
        <SummaryCell
          label={t('summary.conversion')}
          value={`${conversion}%`}
          detail={t('summary.conversionHint')}
        />
      </SummaryStrip>

      {/* Cards below lg — see the finance screen for why a six-column money
          table is not something a phone can usefully scroll sideways. */}
      <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-ink-200">
              {(['plan', 'price', 'benefits', 'active', 'change', 'revenue'] as const).map(
                (c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={`px-4 py-2.5 text-[0.6875rem] font-medium tracking-[0.04em] text-ink-400 uppercase ${
                      i > 2 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {t(`columns.${c}`)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200">
            {rows.map((p) => {
              const delta = p.active - p.activeLastMonth
              const pct =
                p.activeLastMonth === 0 ? 0 : Math.round((delta / p.activeLastMonth) * 1000) / 10
              const up = delta >= 0
              const Arrow = up ? TrendingUp : TrendingDown
              return (
                <tr key={p.id} className="hover:bg-ink-50/60">
                  <td className="px-4 py-3">
                    <p className="text-[0.8125rem] font-semibold text-ink-900">{p.name}</p>
                    <StatusDot
                      tone={p.status === 'live' ? 'success' : 'neutral'}
                      className="mt-0.5 text-[0.625rem]"
                    >
                      {t(`status.${p.status}`)}
                    </StatusDot>
                  </td>
                  <td className="px-4 py-3 text-[0.8125rem] font-medium text-ink-900 tabular-nums">
                    {p.priceGhs === 0 ? t('freeLabel') : ghs(p.priceGhs)}
                  </td>
                  <td className="px-4 py-3 text-[0.75rem] text-ink-600">
                    {p.priceGhs === 0
                      ? t('benefits.none')
                      : t('benefits.value', {
                          multiplier: p.multiplier,
                          ads: p.dailyAdsBonus,
                        })}
                  </td>
                  <td className="px-4 py-3 text-right text-[0.8125rem] font-medium text-ink-900 tabular-nums">
                    {p.active.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-flex items-center gap-1 text-[0.75rem] font-medium tabular-nums ${
                        up ? 'text-success-700' : 'text-danger-700'
                      }`}
                    >
                      <Arrow aria-hidden className="size-3" />
                      {Math.abs(pct)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                    {p.monthlyGhs === 0 ? '—' : ghs(p.monthlyGhs)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((p) => {
          const delta = p.active - p.activeLastMonth
          const pct =
            p.activeLastMonth === 0 ? 0 : Math.round((delta / p.activeLastMonth) * 1000) / 10
          const up = delta >= 0
          const Arrow = up ? TrendingUp : TrendingDown
          return (
            <li
              key={p.id}
              className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-semibold text-ink-900">{p.name}</p>
                  <p className="mt-0.5 text-[0.75rem] text-ink-500">
                    {p.priceGhs === 0
                      ? t('benefits.none')
                      : t('benefits.value', { multiplier: p.multiplier, ads: p.dailyAdsBonus })}
                  </p>
                </div>
                <p className="shrink-0 text-[0.9375rem] font-semibold text-ink-900 tabular-nums">
                  {p.priceGhs === 0 ? t('freeLabel') : ghs(p.priceGhs)}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-ink-200 pt-2.5">
                <span className="text-[0.75rem] text-ink-500">
                  {t('columns.active')}{' '}
                  <span className="font-semibold text-ink-900 tabular-nums">
                    {p.active.toLocaleString()}
                  </span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[0.75rem] font-medium tabular-nums ${
                    up ? 'text-success-700' : 'text-danger-700'
                  }`}
                >
                  <Arrow aria-hidden className="size-3" />
                  {Math.abs(pct)}%
                </span>
                {p.monthlyGhs > 0 && (
                  <span className="ml-auto text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                    {ghs(p.monthlyGhs)}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 max-w-[80ch] text-[0.75rem] leading-relaxed text-ink-400">
        {t('editNote')}
      </p>
    </>
  )
}
