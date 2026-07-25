import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader, StatusDot } from '@/components/admin/AdminChrome'
import { SummaryCell, SummaryStrip } from '@/components/admin/AdminTable'
import { advertisers } from '@/lib/admin/preview'

export const metadata: Metadata = {
  title: 'Admin · Advertisers',
  robots: { index: false, follow: false },
}

const ghs = (n: number) => `GHS ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

const TONE = { active: 'success', pending: 'warning', ended: 'neutral' } as const

/**
 * Advertisers — who is paying, and how much of it has been delivered.
 *
 * These contracts are keyed in by hand: there is no self-serve advertiser
 * portal and this screen does not pretend otherwise. What it does is answer
 * the question that costs money to get wrong — which contract is nearly
 * spent, and which is nearly expired — because an advertiser whose budget
 * ran out is an ad still serving that nobody is paying for.
 *
 * Delivery and time are shown together for that reason. A contract at 98%
 * spent with fifty days left and one at 24% spent with two days left are
 * both problems, and neither is visible from one number alone.
 */
export default async function AdminAdvertisersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.advertisers')

  const rows = advertisers()
  const now = Date.now()
  const active = rows.filter((a) => a.status === 'active')
  const contracted = active.reduce((n, a) => n + a.contractGhs, 0)
  const spent = active.reduce((n, a) => n + a.spentGhs, 0)

  const daysLeft = (iso: string | null) =>
    iso === null ? null : Math.ceil((new Date(iso).getTime() - now) / 86_400_000)

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <SummaryStrip className="mb-5">
        <SummaryCell
          label={t('summary.active')}
          value={active.length}
          detail={t('summary.activeHint', { total: rows.length })}
        />
        <SummaryCell
          label={t('summary.contracted')}
          value={ghs(contracted)}
          detail={t('summary.contractedHint')}
        />
        <SummaryCell
          label={t('summary.remaining')}
          value={ghs(contracted - spent)}
          detail={t('summary.remainingHint')}
        />
      </SummaryStrip>

      {/* Cards below lg — see the finance screen for why a five-column money
          table is not something a phone can usefully scroll sideways. */}
      <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-ink-200">
              {(['advertiser', 'contract', 'delivery', 'ends', 'status'] as const).map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={`px-4 py-2.5 text-[0.6875rem] font-medium tracking-[0.04em] text-ink-400 uppercase ${
                    i === 1 ? 'text-right' : 'text-left'
                  }`}
                >
                  {t(`columns.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200">
            {rows.map((a) => {
              const pct =
                a.contractGhs === 0 ? 0 : Math.min(100, Math.round((a.spentGhs / a.contractGhs) * 100))
              const left = daysLeft(a.endsAt)
              // Either signal alone is enough to want a look at it.
              const urgent = a.status === 'active' && (pct >= 90 || (left !== null && left <= 7))
              return (
                <tr key={a.id} className="hover:bg-ink-50/60">
                  <td className="px-4 py-3">
                    <p className="text-[0.8125rem] font-semibold text-ink-900">{a.name}</p>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-400">{a.contact}</p>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <p className="text-[0.8125rem] font-medium text-ink-900 tabular-nums">
                      {ghs(a.contractGhs)}
                    </p>
                    <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                      {t('spent', { amount: ghs(a.spentGhs) })}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    <div className="min-w-[7rem] max-w-[12rem]">
                      <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div
                          /* Amber only while the contract is still running.
                             A finished contract at 100% is a job done, not a
                             warning, and colouring it as one trains the
                             operator to ignore the colour. */
                          className={`h-full rounded-full ${urgent ? 'bg-warning-500' : 'bg-brand-600'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[0.6875rem] text-ink-500 tabular-nums">
                        {t('deliveredPct', { pct })}
                      </p>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    {left === null ? (
                      <span className="text-[0.75rem] text-ink-400">{t('noEnd')}</span>
                    ) : left < 0 ? (
                      <span className="text-[0.75rem] text-ink-400">{t('ended')}</span>
                    ) : (
                      <span
                        className={`text-[0.75rem] tabular-nums ${
                          left <= 7 ? 'font-medium text-warning-600' : 'text-ink-500'
                        }`}
                      >
                        {t('daysLeft', { days: left })}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <StatusDot tone={TONE[a.status]}>{t(`status.${a.status}`)}</StatusDot>
                    {urgent && (
                      <p className="mt-0.5 text-[0.625rem] font-medium text-warning-600">
                        {t('needsAttention')}
                      </p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((a) => {
          const pct =
            a.contractGhs === 0 ? 0 : Math.min(100, Math.round((a.spentGhs / a.contractGhs) * 100))
          const left = daysLeft(a.endsAt)
          const urgent = a.status === 'active' && (pct >= 90 || (left !== null && left <= 7))
          return (
            <li
              key={a.id}
              className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] font-semibold text-ink-900">{a.name}</p>
                  <p className="mt-0.5 truncate text-[0.6875rem] text-ink-400">{a.contact}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[0.875rem] font-semibold text-ink-900 tabular-nums">
                    {ghs(a.contractGhs)}
                  </p>
                  <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                    {t('spent', { amount: ghs(a.spentGhs) })}
                  </p>
                </div>
              </div>

              <div className="mt-3 border-t border-ink-200 pt-2.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={`h-full rounded-full ${urgent ? 'bg-warning-500' : 'bg-brand-600'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[0.6875rem] text-ink-500 tabular-nums">
                  {t('deliveredPct', { pct })}
                </p>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusDot tone={TONE[a.status]}>{t(`status.${a.status}`)}</StatusDot>
                {/* Suppressed once the contract has ended — the status dot
                    beside it already says so, and "Ended Ended" reads as a
                    bug rather than as emphasis. */}
                {a.status !== 'ended' && (
                  <span
                    className={`text-[0.6875rem] tabular-nums ${
                      left !== null && left >= 0 && left <= 7
                        ? 'font-medium text-warning-600'
                        : 'text-ink-400'
                    }`}
                  >
                    {left === null ? t('noEnd') : t('daysLeft', { days: left })}
                  </span>
                )}
                {urgent && (
                  <span className="text-[0.6875rem] font-medium text-warning-600">
                    {t('needsAttention')}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 max-w-[80ch] text-[0.75rem] leading-relaxed text-ink-400">
        {t('manualNote')}
      </p>
    </>
  )
}
