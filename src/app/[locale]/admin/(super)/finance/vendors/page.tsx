import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { VendorSalesReport } from '@/components/admin/VendorSalesReport'
import { Link } from '@/i18n/navigation'
import {
  getVendorSalesReport,
  periodRange,
  type SalesPeriod,
} from '@/lib/admin/data/vendor-sales'
import { cn } from '@/lib/cn'

export const metadata: Metadata = {
  title: 'Admin · Vendor sales',
  robots: { index: false, follow: false },
}

const PERIODS: SalesPeriod[] = ['this_month', 'last_month', 'last_90', 'all']

const isPeriod = (v: string | undefined): v is SalesPeriod =>
  PERIODS.includes(v as SalesPeriod)

/**
 * Vendor settlement, under Finance because that is where the operator goes to
 * think about money leaving.
 *
 * ── THE PERIOD IS IN THE URL, NOT IN STATE ──
 *
 * So a report can be linked, reloaded and bookmarked, and so the whole screen
 * stays a Server Component apart from the table's own expand/export. The
 * alternative — fetching four periods client-side — would ship every vendor's
 * revenue to the browser for periods nobody asked to see.
 */
export default async function AdminVendorSalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { locale } = await params
  const { period: raw } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('admin.vendorSales')

  const period: SalesPeriod = isPeriod(raw) ? raw : 'this_month'
  const { from, to } = periodRange(period)
  const report = await getVendorSalesReport(from, to)

  return (
    <>
      <Link
        href="/admin/finance"
        className="mb-3 inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <PageHeader title={t('title')} description={t('description')} />

      <nav aria-label={t('periodLabel')} className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((key) => (
          <Link
            key={key}
            href={`/admin/finance/vendors?period=${key}`}
            aria-current={key === period ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
              key === period
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-300 text-ink-700 hover:border-ink-400',
            )}
          >
            {t(`period.${key}`)}
          </Link>
        ))}
      </nav>

      <VendorSalesReport report={report} period={period} />
    </>
  )
}
