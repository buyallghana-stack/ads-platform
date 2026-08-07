import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { SummaryCell, SummaryStrip, TableShell, Th } from '@/components/admin/AdminTable'
import { Link } from '@/i18n/navigation'
import {
  getCommissionLedger,
  getPromotionReport,
  programmeShare,
} from '@/lib/admin/data/affiliates'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

export const metadata: Metadata = {
  title: 'Admin · Where commission comes from',
  robots: { index: false, follow: false },
}

const WINDOWS = [30, 90, 365] as const

/**
 * How much of the commission is recruiting, and how much is selling.
 *
 * ── WHY THIS SCREEN EXISTS ──
 *
 * Training sales pay commission at both levels (C16). Paid entry plus a
 * commission for bringing in people who also pay entry is the shape a
 * regulator looks at twice, and the decision to allow it was kept reversible
 * on one condition: that the split is measurable. This is where it is
 * measured. It matters more now than when it was written, because games and
 * tasks pay cash as well.
 *
 * So the headline is one number, the share of commission that came from
 * selling the training rather than selling a product. Everything else on the
 * screen exists to let somebody check that number rather than take it.
 *
 * Server rendered: nothing here is interactive beyond the window links, and
 * shipping a client bundle to render two tables would be a cost with no
 * return.
 */
export default async function AdminPromotionReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ days?: string; view?: string }>
}) {
  const { locale } = await params
  const { days: rawDays, view } = await searchParams
  setRequestLocale(locale)

  const t = await getTranslations('admin.promotion')
  const format = await getFormatter()

  const days = WINDOWS.includes(Number(rawDays) as (typeof WINDOWS)[number])
    ? Number(rawDays)
    : 30
  const ledgerView = view === 'ledger'

  const [rows, ledger] = await Promise.all([
    getPromotionReport(days),
    ledgerView ? getCommissionLedger(days) : Promise.resolve([]),
  ])

  /* A ratio of totals, never an average of the per-affiliate percentages. See
     `programmeShare`, which is unit-tested for that distinction. */
  const totals = programmeShare(rows)
  const share = totals.sharePct

  return (
    <>
      <Link
        href="/admin/affiliates"
        className="mb-3 inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <PageHeader title={t('title')} description={t('description')} />

      <nav aria-label={t('windowLabel')} className="mb-4 flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w}
            href={`/admin/affiliates/report?days=${w}${ledgerView ? '&view=ledger' : ''}`}
            aria-current={w === days ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
              w === days
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-300 text-ink-700 hover:border-ink-400',
            )}
          >
            {t('window', { n: w })}
          </Link>
        ))}
        <span className="mx-1 w-px bg-ink-200" aria-hidden />
        {(['summary', 'ledger'] as const).map((v) => (
          <Link
            key={v}
            href={`/admin/affiliates/report?days=${days}${v === 'ledger' ? '&view=ledger' : ''}`}
            aria-current={(v === 'ledger') === ledgerView ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
              (v === 'ledger') === ledgerView
                ? 'border-ink-900 bg-ink-900 text-canvas'
                : 'border-ink-300 text-ink-700 hover:border-ink-400',
            )}
          >
            {t(`view.${v}`)}
          </Link>
        ))}
      </nav>

      {/* The number the whole screen is for, and it is emphasised whether it is
          high or low: this is not a warning light, it is a measurement. */}
      <SummaryStrip cols={4} className="mb-4">
        <SummaryCell
          label={t('summary.share')}
          value={`${share.toFixed(1)}%`}
          detail={t('summary.shareDetail')}
          emphasis
        />
        <SummaryCell label={t('summary.training')} value={cedis(totals.trainingMinor)} />
        <SummaryCell label={t('summary.product')} value={cedis(totals.productMinor)} />
        <SummaryCell
          label={t('summary.total')}
          value={cedis(totals.totalMinor)}
          detail={t('summary.recruits', { n: totals.recruits })}
        />
      </SummaryStrip>

      <p className="mb-4 rounded-(--radius-card) border border-ink-200 bg-ink-50 px-4 py-3 text-[0.75rem] leading-relaxed text-ink-600">
        {t('note')}
      </p>

      {ledgerView ? (
        ledger.length === 0 ? (
          <Empty>{t('emptyLedger')}</Empty>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>{t('ledger.when')}</Th>
                <Th>{t('ledger.affiliate')}</Th>
                <Th width="hidden xl:table-cell">{t('ledger.what')}</Th>
                <Th>{t('ledger.kind')}</Th>
                <Th align="right">{t('ledger.amount')}</Th>
                <Th>{t('ledger.status')}</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id} className="border-t border-ink-200">
                  <td className="px-4 py-2.5 text-[0.75rem] whitespace-nowrap text-ink-500">
                    {format.dateTime(new Date(row.createdAt), { dateStyle: 'medium' })}
                  </td>
                  <td className="px-4 py-2.5 text-[0.8125rem] text-ink-900">
                    {row.affiliateName || row.code}
                    {row.level !== null && (
                      <span className="ml-1.5 text-[0.6875rem] text-ink-400">
                        {t('ledger.level', { n: row.level })}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 text-[0.8125rem] text-ink-600 xl:table-cell">
                    {row.productTitle ?? row.reason ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-[0.75rem] text-ink-600">
                    {t(`kind.${row.entryType}`)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right text-[0.8125rem] font-semibold tabular-nums',
                      row.amountMinor < 0 ? 'text-danger-600' : 'text-ink-900',
                    )}
                  >
                    {cedis(row.amountMinor)}
                  </td>
                  <td className="px-4 py-2.5 text-[0.75rem] text-ink-500">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )
      ) : rows.length === 0 ? (
        <Empty>{t('empty')}</Empty>
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>{t('col.affiliate')}</Th>
              <Th align="right">{t('col.training')}</Th>
              <Th align="right">{t('col.product')}</Th>
              <Th align="right">{t('col.share')}</Th>
              <Th align="right" width="hidden xl:table-cell">
                {t('col.recruits')}
              </Th>
              <Th align="right" width="hidden xl:table-cell">
                {t('col.conversion')}
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.affiliateId} className="border-t border-ink-200">
                <td className="px-4 py-2.5">
                  <p className="text-[0.8125rem] font-medium text-ink-900">{row.name || row.code}</p>
                  <p className="text-[0.6875rem] text-ink-400">{row.code}</p>
                </td>
                <td className="px-4 py-2.5 text-right text-[0.8125rem] tabular-nums text-ink-800">
                  {cedis(row.trainingMinor)}
                </td>
                <td className="px-4 py-2.5 text-right text-[0.8125rem] tabular-nums text-ink-800">
                  {cedis(row.productMinor)}
                </td>
                <td
                  className={cn(
                    'px-4 py-2.5 text-right text-[0.8125rem] font-semibold tabular-nums',
                    row.recruitmentSharePct >= 50 ? 'text-warning-600' : 'text-ink-900',
                  )}
                >
                  {row.recruitmentSharePct.toFixed(0)}%
                </td>
                <td className="hidden px-4 py-2.5 text-right text-[0.8125rem] tabular-nums text-ink-600 xl:table-cell">
                  {row.recruits}
                </td>
                <td className="hidden px-4 py-2.5 text-right text-[0.8125rem] tabular-nums text-ink-600 xl:table-cell">
                  {row.conversionRatePct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {/* Below lg the shell is hidden, so the same rows go out as cards. */}
      {!ledgerView && rows.length > 0 && (
        <ul className="flex flex-col gap-2 lg:hidden">
          {rows.map((row) => (
            <li
              key={row.affiliateId}
              className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] font-semibold text-ink-900">
                    {row.name || row.code}
                  </p>
                  <p className="text-[0.6875rem] text-ink-400">{row.code}</p>
                </div>
                <p
                  className={cn(
                    'shrink-0 text-[1rem] font-bold tabular-nums',
                    row.recruitmentSharePct >= 50 ? 'text-warning-600' : 'text-ink-900',
                  )}
                >
                  {row.recruitmentSharePct.toFixed(0)}%
                </p>
              </div>
              <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-ink-200 pt-2.5 text-[0.75rem]">
                <div>
                  <dt className="text-[0.6875rem] text-ink-400">{t('col.training')}</dt>
                  <dd className="tabular-nums text-ink-800">{cedis(row.trainingMinor)}</dd>
                </div>
                <div>
                  <dt className="text-[0.6875rem] text-ink-400">{t('col.product')}</dt>
                  <dd className="tabular-nums text-ink-800">{cedis(row.productMinor)}</dd>
                </div>
                <div>
                  <dt className="text-[0.6875rem] text-ink-400">{t('col.recruits')}</dt>
                  <dd className="tabular-nums text-ink-800">{row.recruits}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-14 text-center text-[0.8125rem] text-ink-400">
      {children}
    </p>
  )
}
