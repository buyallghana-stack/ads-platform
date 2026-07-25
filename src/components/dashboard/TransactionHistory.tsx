'use client'

import { useMemo, useState } from 'react'

import {
  Coins,
  CreditCard,
  Gift,
  ListChecks,
  PlayCircle,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Smartphone,
  Gem,
  Wrench,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/Badge'
import type { TxKind, TxRow } from '@/lib/dashboard/home-data'
import { cn } from '@/lib/cn'

/**
 * Transaction history (operator spec 2026-07-24): every row shows what
 * happened, how, when, the signed amount and the balance after it — the
 * bank-statement pattern — with search, a type filter and sort on top.
 *
 * Presentation splits by pointer real estate:
 *   mobile   rows grouped under day headings, no columns — a statement feed
 *   md+      a proper table with a running-balance column
 *
 * Everything filters client-side over the page the server sent (newest 60 +
 * 20 subscription rows). That covers months of a capped earner's activity;
 * server-driven pagination arrives with the full history screen.
 */

const KIND_ORDER: TxKind[] = ['ad', 'survey', 'bonus', 'withdrawal', 'refund', 'subscription', 'adjustment']

const KIND_ICON: Record<TxKind, React.ComponentType<{ className?: string }>> = {
  ad: PlayCircle,
  survey: ListChecks,
  bonus: Gift,
  withdrawal: Smartphone,
  refund: RotateCcw,
  subscription: Gem,
  adjustment: Wrench,
}

/** Known method values (payout_method + subscription_payment_method enums). */
const METHOD_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  mobile_money: Smartphone,
  crypto: Coins,
  korapay: CreditCard,
}

/**
 * Meaning-coded chip tints (see the accent tokens in globals.css): the icon
 * chip identifies the category before the label is read — earnings green,
 * bonuses orange, payouts brand blue, refunds teal, plans violet. Colour is
 * assigned to the category, never to the row's sign; the amount column
 * carries direction.
 */
const KIND_CHIP: Record<TxKind, string> = {
  ad: 'bg-success-50 text-success-600',
  // Same green as a watched ad: both are money in, and the platform's accent
  // hues carry fixed meanings. Format is told apart by the icon and the label.
  survey: 'bg-success-50 text-success-600',
  bonus: 'bg-orange-50 text-orange-600',
  withdrawal: 'bg-brand-50 text-brand-600',
  refund: 'bg-teal-50 text-teal-600',
  subscription: 'bg-violet-50 text-violet-600',
  adjustment: 'bg-ink-100 text-ink-500',
}

/** Method beats kind for the icon — a crypto payout should not show a phone. */
function iconFor(row: TxRow) {
  return (row.method && METHOD_ICON[row.method]) || KIND_ICON[row.kind]
}

type SortKey = 'newest' | 'oldest' | 'largest' | 'smallest'

export function TransactionHistory({ rows }: { rows: TxRow[] }) {
  const t = useTranslations('dashboard.history')
  const format = useFormatter()

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<TxKind | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [limit, setLimit] = useState(15)

  const kindsPresent = useMemo(
    () => KIND_ORDER.filter((k) => rows.some((r) => r.kind === k)),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const magnitude = (r: TxRow) => (r.points !== null ? Math.abs(r.points) : r.ghs * 1000)
    return rows
      .filter((r) => kind === 'all' || r.kind === kind)
      .filter((r) => {
        if (!q) return true
        const hay = [
          t(`kind.${r.kind}`),
          r.method ?? '',
          r.points !== null ? String(Math.abs(r.points)) : '',
          r.ghs.toFixed(2),
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => {
        switch (sort) {
          case 'newest': return a.at < b.at ? 1 : -1
          case 'oldest': return a.at > b.at ? 1 : -1
          case 'largest': return magnitude(b) - magnitude(a)
          case 'smallest': return magnitude(a) - magnitude(b)
        }
      })
  }, [rows, query, kind, sort, t])

  const visible = filtered.slice(0, limit)

  // Day grouping for the mobile feed. Keys are locale-formatted labels.
  const groups = useMemo(() => {
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 86400000).toDateString()
    const out: Array<{ label: string; items: TxRow[] }> = []
    for (const row of visible) {
      const d = new Date(row.at)
      const label =
        d.toDateString() === today
          ? t('today')
          : d.toDateString() === yesterday
            ? t('yesterday')
            : format.dateTime(d, { day: 'numeric', month: 'short', year: 'numeric' })
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(row)
      else out.push({ label, items: [row] })
    }
    return out
  }, [visible, format, t])

  const amountCell = (r: TxRow) => (
    <div className="text-right">
      <p
        className={cn(
          'text-[0.8125rem] font-semibold tabular-nums',
          r.direction === 'in' ? 'text-success-700' : 'text-ink-900',
        )}
      >
        {r.points !== null
          ? `${r.direction === 'in' ? '+' : '−'}${format.number(Math.abs(r.points))} pts`
          : `${r.direction === 'in' ? '+' : '−'}GHS ${format.number(r.ghs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      </p>
      {r.points !== null && (
        <p className="text-[0.6875rem] tabular-nums text-ink-400">
          ≈ GHS {format.number(r.ghs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      )}
    </div>
  )

  const identity = (r: TxRow) => {
    const Icon = iconFor(r)
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn('grid size-9 shrink-0 place-items-center rounded-full', KIND_CHIP[r.kind])}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-900">
            <span className="truncate">{t(`kind.${r.kind}`)}</span>
            {r.status !== 'settled' && (
              <Badge tone={r.status === 'failed' ? 'danger' : 'warning'}>{t(r.status)}</Badge>
            )}
          </p>
          <p className="text-[0.6875rem] text-ink-400">
            {r.method
              ? r.method in METHOD_ICON
                ? t(`method.${r.method as 'mobile_money' | 'crypto' | 'korapay'}`)
                : r.method
              : t(`kindHint.${r.kind}`)}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Controls: search + type chips + sort, one row that wraps           */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col gap-2.5 border-b border-ink-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="h-8 w-full rounded-(--radius-input) border border-ink-200 bg-surface pl-8 pr-3 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 hover:border-ink-300 focus:border-brand-600 focus:outline-none focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12 pointer-coarse:h-10 pointer-coarse:text-base"
            />
          </div>

          <label className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-ink-500">
            <SlidersHorizontal aria-hidden className="size-3.5" />
            <span className="sr-only">{t('sortLabel')}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 rounded-(--radius-input) border border-ink-200 bg-surface px-2 text-[0.8125rem] text-ink-700 hover:border-ink-300 focus:border-brand-600 focus:outline-none pointer-coarse:h-10 pointer-coarse:text-base"
            >
              {(['newest', 'oldest', 'largest', 'smallest'] as const).map((s) => (
                <option key={s} value={s}>{t(`sort.${s}`)}</option>
              ))}
            </select>
          </label>
        </div>

        {kindsPresent.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('filterLabel')}>
            {(['all', ...kindsPresent] as const).map((k) => (
              <button
                key={k}
                aria-pressed={kind === k}
                onClick={() => { setKind(k as TxKind | 'all'); setLimit(15) }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[0.75rem] font-medium transition-colors',
                  kind === k
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-ink-200 text-ink-500 hover:border-ink-300 hover:text-ink-700',
                )}
              >
                {k === 'all' ? t('allTypes') : t(`kind.${k}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Empty states                                                        */}
      {/* ------------------------------------------------------------------ */}
      {filtered.length === 0 && (
        <p className="px-4 py-10 text-center text-[0.8125rem] text-ink-400">
          {rows.length === 0 ? t('emptyAll') : t('emptyFiltered')}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Mobile: statement feed grouped by day                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="md:hidden">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="bg-ink-50 px-4 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
              {g.label}
            </p>
            <ul className="divide-y divide-ink-100">
              {g.items.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  {identity(r)}
                  <div className="shrink-0 text-right">
                    {amountCell(r)}
                    <p className="mt-0.5 text-[0.625rem] tabular-nums text-ink-400">
                      {format.dateTime(new Date(r.at), { hour: 'numeric', minute: '2-digit' })}
                      {r.balanceAfter !== null &&
                        ` · ${t('balanceShort', { balance: format.number(r.balanceAfter) })}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* md+: statement table with running balance                           */}
      {/* ------------------------------------------------------------------ */}
      {visible.length > 0 && (
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ink-200 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                <th className="px-4 py-2.5 font-semibold">{t('columns.transaction')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('columns.date')}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t('columns.amount')}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t('columns.balance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{identity(r)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <p className="text-[0.8125rem] text-ink-700">
                      {format.dateTime(new Date(r.at), { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <p className="text-[0.6875rem] tabular-nums text-ink-400">
                      {format.dateTime(new Date(r.at), { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{amountCell(r)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-[0.8125rem] tabular-nums text-ink-700">
                    {r.balanceAfter !== null ? `${format.number(r.balanceAfter)} pts` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > limit && (
        <div className="border-t border-ink-200 px-4 py-3 text-center">
          <button
            onClick={() => setLimit((n) => n + 15)}
            className="text-[0.8125rem] font-medium text-brand-700 hover:text-brand-600"
          >
            {t('showMore', { count: filtered.length - limit })}
          </button>
        </div>
      )}
    </div>
  )
}
