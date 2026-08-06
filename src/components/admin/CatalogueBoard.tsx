'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react'

import {
  EmptyState,
  SummaryCell,
  SummaryStrip,
  TableShell,
  Th,
  Toolbar,
} from '@/components/admin/AdminTable'
import { Badge } from '@/components/ui/Badge'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { CatalogueRow } from '@/lib/admin/catalogue-data'

/**
 * The catalogue list.
 *
 * Built on the shared admin furniture rather than inventing a layout: eight
 * screens that each invent their own filter row is the complaint that started
 * the admin rebuild, and this is the ninth.
 *
 * ---------------------------------------------------------------------------
 * READINESS IS THE COLUMN THAT MATTERS
 *
 * Every other admin list is about things that already exist and are working.
 * A catalogue is mostly about things that are half-built, so the question the
 * operator asks on this screen is not "what have I got" but "what is stopping
 * this going on sale".
 *
 * So `blockers` gets a real column rather than being hidden behind the editor,
 * and a draft with none is called out as ready. Otherwise a product sits at
 * 100% done and nobody notices for a week.
 */

type Tab = 'all' | 'training' | 'products' | 'drafts'

export function CatalogueBoard({ rows }: { rows: CatalogueRow[] }) {
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab === 'training' && r.purpose !== 'training_program') return false
      if (tab === 'products' && r.purpose !== 'vendor_product') return false
      if (tab === 'drafts' && r.status !== 'draft') return false
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        (r.vendor_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, tab, query])

  const published = rows.filter((r) => r.status === 'published').length
  const blocked = rows.filter((r) => r.status !== 'published' && r.blockers > 0).length
  const ready = rows.filter((r) => r.status !== 'published' && r.blockers === 0).length

  return (
    <>
      <SummaryStrip cols={3} className="mb-4">
        <SummaryCell label="On sale" value={String(published)} />
        {/* Ready-but-not-published is the actionable number on this screen —
            work already finished that is earning nothing. */}
        <SummaryCell label="Ready to publish" value={String(ready)} emphasis={ready > 0} />
        <SummaryCell label="Not ready" value={String(blocked)} />
      </SummaryStrip>

      <Toolbar<Tab>
        tabs={[
          { key: 'all', label: 'All', count: rows.length },
          {
            key: 'training',
            label: 'Training',
            count: rows.filter((r) => r.purpose === 'training_program').length,
          },
          {
            key: 'products',
            label: 'Vendor products',
            count: rows.filter((r) => r.purpose === 'vendor_product').length,
          },
          {
            key: 'drafts',
            label: 'Drafts',
            count: rows.filter((r) => r.status === 'draft').length,
          },
        ]}
        active={tab}
        onSelect={setTab}
        tabsLabel="Filter the catalogue"
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search title, short name or vendor"
        actions={
          <Link
            href="/admin/catalogue/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-(--radius-input) bg-brand-600 px-3 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <Plus aria-hidden className="size-4" />
            New product
          </Link>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState>
          {rows.length === 0
            ? 'Nothing in the catalogue yet. Create a product to start building a course.'
            : 'Nothing matches that.'}
        </EmptyState>
      ) : (
        <>
          {/* PHONE: cards. A seven-column table cannot be read at 390px, and
              the platform rule is that wide content never makes the page
              scroll sideways. */}
          <ul className="space-y-3 lg:hidden">
            {filtered.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/catalogue/${row.id}`}
                  className="block rounded-(--radius-card) border border-ink-200 bg-surface p-3.5 transition-colors hover:border-ink-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-sm font-semibold text-ink-900">
                      {row.title}
                    </p>
                    <StatusBadge row={row} />
                  </div>
                  <p className="mt-0.5 text-[0.75rem] text-ink-500">
                    {row.vendor_name ?? 'No vendor'} · {row.sections} sections · {row.lessons}{' '}
                    lessons
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <Price row={row} />
                    <Readiness row={row} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/*
            TableShell RENDERS THE <table> ITSELF — it takes rows, not a table.
            Wrapping a second one inside it produced a nested table, which is
            invalid HTML: the browser reparents it, so the server markup and
            the client's stop matching and React throws hydration error #418.
            It also already carries `hidden lg:block`, so passing that again
            did nothing.
          */}
          <TableShell>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Vendor</Th>
                <Th align="right">Price</Th>
                <Th align="right">Content</Th>
                <Th align="right">Commission</Th>
                <Th align="right">Sales</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {filtered.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-ink-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/catalogue/${row.id}`} className="block min-w-0">
                      <span className="block text-[0.875rem] font-medium text-ink-900">
                        {row.title}
                      </span>
                      <span className="block text-[0.75rem] text-ink-500">
                        {row.purpose === 'training_program' ? 'Training' : row.kind} · {row.slug}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[0.8125rem] text-ink-600">
                    {row.vendor_name ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Price row={row} />
                  </td>
                  <td className="px-4 py-2.5 text-right text-[0.8125rem] tabular-nums text-ink-600">
                    {row.lessons > 0 ? `${row.lessons} in ${row.sections}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[0.8125rem] tabular-nums text-ink-600">
                    {row.l1_rate === null ? '—' : `${row.l1_rate}% / ${row.l2_rate ?? 0}%`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[0.8125rem] tabular-nums text-ink-600">
                    {row.sales || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <StatusBadge row={row} />
                      <Readiness row={row} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}
    </>
  )
}

function StatusBadge({ row }: { row: CatalogueRow }) {
  const tone =
    row.status === 'published' ? 'success' : row.status === 'paused' ? 'warning' : 'neutral'
  return (
    <Badge tone={tone} dot className="shrink-0 capitalize">
      {row.status}
    </Badge>
  )
}

function Price({ row }: { row: CatalogueRow }) {
  const onSale = row.sale_price_ghs !== null && row.sale_price_ghs < row.price_ghs
  return (
    <span className="text-[0.8125rem] tabular-nums text-ink-900">
      {onSale && (
        <span className="mr-1.5 text-ink-400 line-through">GHS {row.price_ghs.toFixed(2)}</span>
      )}
      GHS {row.effective_price_ghs.toFixed(2)}
    </span>
  )
}

/**
 * Whether this product can go on sale.
 *
 * Silent once published — at that point it is live and the question has been
 * answered. The two states that matter are "finished but not switched on" and
 * "something is missing", and they are deliberately different colours because
 * one is an opportunity and the other is a task.
 */
function Readiness({ row }: { row: CatalogueRow }) {
  if (row.status === 'published') return null

  if (row.blockers > 0) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-[0.75rem] font-medium text-warning-600')}
        title={`${row.blockers} thing${row.blockers === 1 ? '' : 's'} to fix before this can be published`}
      >
        <AlertTriangle aria-hidden className="size-3.5" />
        {row.blockers}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-success-700">
      <CheckCircle2 aria-hidden className="size-3.5" />
      Ready
    </span>
  )
}
