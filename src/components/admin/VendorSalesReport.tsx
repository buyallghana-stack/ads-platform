'use client'

import { useMemo, useState } from 'react'

import { ChevronDown, Download, Info } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { VendorSalesReport as Report } from '@/lib/admin/data/vendor-sales'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

import { EmptyState, SummaryCell, SummaryStrip, TableShell, Th } from './AdminTable'

/**
 * What each vendor's products sold, grouped by the person you pay.
 *
 * ── THE COLUMN THAT IS NOT HERE ──
 *
 * "Owed". Decision A4 is that the system never tracks money owed to a vendor —
 * the Owner licenses the product outright — and no licence terms exist
 * anywhere in the schema. A column computing one would be an invented number
 * on a money screen, which is worse than no number at all. The note under the
 * table says so, rather than leaving an operator to wonder which figure to
 * pay.
 *
 * ── ONE ROW RECONCILES BY EYE ──
 *
 *     gross − refunded − commission = net
 *
 * Laid out in that order for the same reason the affiliate roster is: a
 * settlement figure an operator cannot check is a settlement figure they will
 * not trust. The period is on the sale's confirmation, so a refund lands in
 * the period the sale did — otherwise a row shows a deduction with no sale
 * above it to explain it.
 *
 * ── THE CSV IS THE POINT, NOT A FEATURE ──
 *
 * A3: settlement is a CSV the admin exports and sends by hand. It is built in
 * the browser from the rows already on screen — no export endpoint, so there
 * is no second place where vendor revenue can be fetched from, and no URL that
 * could be shared by accident.
 */
export function VendorSalesReport({
  report,
  period,
}: {
  report: Report
  /** Echoed into the file name so a downloaded CSV says what it covers. */
  period: string
}) {
  const t = useTranslations('admin.vendorSales')
  const [openVendor, setOpenVendor] = useState<string | null>(null)

  const totals = useMemo(
    () =>
      report.vendors.reduce(
        (acc, v) => ({
          gross: acc.gross + v.grossMinor,
          refunded: acc.refunded + v.refundedMinor,
          commission: acc.commission + v.commissionMinor,
          net: acc.net + v.netMinor,
          units: acc.units + v.units,
        }),
        { gross: 0, refunded: 0, commission: 0, net: 0, units: 0 },
      ),
    [report.vendors],
  )

  const download = () => {
    const header = [
      'vendor',
      'status',
      'products_sold',
      'units',
      'gross_ghs',
      'list_ghs',
      'refunded_units',
      'refunded_ghs',
      'affiliate_commission_ghs',
      'net_ghs',
    ]
    /* Major units in the file: it is opened in a spreadsheet by a person, not
       parsed by anything. Quotes doubled per RFC 4180 — a vendor called
       O'Brien & Sons "Ltd" must not shift every column after it. */
    const cell = (v: string | number) =>
      typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`
    const major = (minor: number) => (minor / 100).toFixed(2)

    const lines = [
      header.join(','),
      ...report.vendors.map((v) =>
        [
          cell(v.name),
          cell(v.status),
          v.products,
          v.units,
          major(v.grossMinor),
          major(v.listMinor),
          v.refundedUnits,
          major(v.refundedMinor),
          major(v.commissionMinor),
          major(v.netMinor),
        ].join(','),
      ),
    ]

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vendor-sales-${period}-${report.from.slice(0, 10)}-to-${report.to.slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (report.vendors.length === 0) {
    return (
      <>
        <EmptyState>{t('empty')}</EmptyState>
        <Note t={t} />
      </>
    )
  }

  return (
    <>
      <SummaryStrip cols={4} className="mb-4">
        <SummaryCell
          label={t('summary.gross')}
          value={cedis(totals.gross)}
          detail={t('summary.units', { n: totals.units })}
        />
        <SummaryCell label={t('summary.refunded')} value={cedis(totals.refunded)} />
        <SummaryCell label={t('summary.commission')} value={cedis(totals.commission)} />
        <SummaryCell label={t('summary.net')} value={cedis(totals.net)} />
      </SummaryStrip>

      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-2 rounded-(--radius-input) border border-ink-300 px-3 py-2 text-[0.8125rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
        >
          <Download aria-hidden className="size-4" />
          {t('export')}
        </button>
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>{t('col.vendor')}</Th>
            <Th align="right">{t('col.units')}</Th>
            <Th align="right">{t('col.gross')}</Th>
            <Th align="right" width="hidden xl:table-cell">
              {t('col.refunded')}
            </Th>
            <Th align="right" width="hidden xl:table-cell">
              {t('col.commission')}
            </Th>
            <Th align="right">{t('col.net')}</Th>
          </tr>
        </thead>
        <tbody>
          {report.vendors.map((v) => {
            const products = report.products.filter((p) => p.vendorId === v.vendorId)
            const isOpen = openVendor === v.vendorId
            return (
              <Rows
                key={v.vendorId}
                vendor={v}
                products={products}
                isOpen={isOpen}
                onToggle={() => setOpenVendor(isOpen ? null : v.vendorId)}
                t={t}
              />
            )
          })}
        </tbody>
      </TableShell>

      {/* Below lg, the same figures as cards. */}
      <ul className="flex flex-col gap-2 lg:hidden">
        {report.vendors.map((v) => (
          <li
            key={v.vendorId}
            className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[0.9375rem] font-semibold text-ink-900">{v.name}</p>
                <p className="text-[0.75rem] text-ink-500">
                  {t('card.units', { n: v.units, products: v.products })}
                </p>
              </div>
              <p className="shrink-0 text-[0.9375rem] font-bold tabular-nums text-ink-900">
                {cedis(v.netMinor)}
              </p>
            </div>
            <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-ink-200 pt-2.5 text-[0.75rem]">
              <Cell label={t('col.gross')} value={cedis(v.grossMinor)} />
              <Cell label={t('col.refunded')} value={cedis(v.refundedMinor)} />
              <Cell label={t('col.commission')} value={cedis(v.commissionMinor)} />
            </dl>
          </li>
        ))}
      </ul>

      <Note t={t} />
    </>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] text-ink-400">{label}</dt>
      <dd className="tabular-nums text-ink-800">{value}</dd>
    </div>
  )
}

/** A vendor, and their products underneath when opened. */
function Rows({
  vendor,
  products,
  isOpen,
  onToggle,
  t,
}: {
  vendor: Report['vendors'][number]
  products: Report['products']
  isOpen: boolean
  onToggle: () => void
  t: (key: string, values?: Record<string, string | number>) => string
}) {
  return (
    <>
      <tr className="border-t border-ink-200 hover:bg-ink-50">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            className="flex items-center gap-2 text-left text-[0.875rem] font-medium text-ink-900"
          >
            <ChevronDown
              aria-hidden
              className={cn('size-4 shrink-0 text-ink-400 transition-transform', isOpen && 'rotate-180')}
            />
            <span className="min-w-0">
              <span className="block truncate">{vendor.name}</span>
              <span className="block text-[0.75rem] text-ink-500">
                {t('card.products', { n: vendor.products })}
              </span>
            </span>
          </button>
        </td>
        <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums text-ink-700">
          {vendor.units}
        </td>
        <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums text-ink-800">
          {cedis(vendor.grossMinor)}
        </td>
        <td className="hidden px-4 py-3 text-right text-[0.8125rem] tabular-nums text-ink-600 xl:table-cell">
          {vendor.refundedMinor === 0 ? '—' : `− ${cedis(vendor.refundedMinor)}`}
        </td>
        <td className="hidden px-4 py-3 text-right text-[0.8125rem] tabular-nums text-ink-600 xl:table-cell">
          {vendor.commissionMinor === 0 ? '—' : `− ${cedis(vendor.commissionMinor)}`}
        </td>
        <td className="px-4 py-3 text-right text-[0.875rem] font-semibold tabular-nums text-ink-900">
          {cedis(vendor.netMinor)}
        </td>
      </tr>

      {isOpen &&
        products.map((p) => (
          <tr key={p.productId} className="border-t border-ink-200 bg-ink-50/50">
            <td className="py-2 pl-12 pr-4 text-[0.8125rem] text-ink-700">{p.title}</td>
            <td className="px-4 py-2 text-right text-[0.75rem] tabular-nums text-ink-600">
              {p.units}
            </td>
            <td className="px-4 py-2 text-right text-[0.75rem] tabular-nums text-ink-600">
              {cedis(p.grossMinor)}
            </td>
            <td className="hidden px-4 py-2 text-right text-[0.75rem] tabular-nums text-ink-500 xl:table-cell">
              {p.refundedMinor === 0 ? '—' : `− ${cedis(p.refundedMinor)}`}
            </td>
            <td className="hidden px-4 py-2 text-right text-[0.75rem] tabular-nums text-ink-500 xl:table-cell">
              {p.commissionMinor === 0 ? '—' : `− ${cedis(p.commissionMinor)}`}
            </td>
            <td className="px-4 py-2 text-right text-[0.75rem] tabular-nums text-ink-700">
              {cedis(p.netMinor)}
            </td>
          </tr>
        ))}
    </>
  )
}

/** Says out loud which figure is not on this screen, and why. */
function Note({ t }: { t: (key: string) => string }) {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-(--radius-card) border border-ink-200 bg-ink-50 px-4 py-3 text-[0.75rem] leading-relaxed text-ink-600">
      <Info aria-hidden className="mt-px size-3.5 shrink-0 text-ink-400" />
      {t('note')}
    </p>
  )
}
