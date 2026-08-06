'use client'

import { useMemo, useState } from 'react'

import {
  ChevronDown,
  ChevronRight,
  Coins,
  CreditCard,
  Gift,
  ListChecks,
  PlayCircle,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Smartphone,
  Gamepad2,
  Target,
  Gem,
  Ticket,
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

const KIND_ORDER: TxKind[] = ['ad', 'survey', 'bonus', 'gift', 'game', 'task', 'withdrawal', 'refund', 'subscription', 'adjustment']

const KIND_ICON: Record<TxKind, React.ComponentType<{ className?: string }>> = {
  ad: PlayCircle,
  survey: ListChecks,
  bonus: Gift,
  // A voucher, not a present: `Gift` is already the referral bonus's icon, and
  // two orange chips are told apart by their glyph the same way a watched ad
  // and a survey are.
  gift: Ticket,
  game: Gamepad2,
  task: Target,
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
  // Orange too: points that arrived without an ad being watched. The shortcut
  // tile on Home is the same hue, so the row matches where it came from.
  gift: 'bg-orange-50 text-orange-600',
  // Violet, the premium hue — a game win is the one credit that is luck.
  game: 'bg-violet-50 text-violet-600',
  // Teal, the 'something you set up' hue this app already uses for refunds
  // and profile — a task reward is progress, not luck and not earnings.
  task: 'bg-teal-50 text-teal-600',
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

  /* Which runs the reader has opened. Collapsed by default — see the note on
     `groups` below. */
  const [opened, setOpened] = useState<Set<string>>(new Set())

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

  /*
    RUNS: consecutive entries of the same kind, within one day, rolled into a
    single line.

    Somebody who watches eight ads produces eight ledger rows that differ only
    in the number of points. Listed individually they were roughly sixty per
    cent of the dashboard's height and said one thing eight times — the reader
    scrolls past a wall to reach anything else, and learns nothing they did not
    already know from the balance.

    Rolled up, the same day reads "Ads · 8 watched · +812 pts", which is the
    sentence they would actually say out loud. The detail is one tap away and
    nothing is hidden or lost.

    THREE is the threshold, not two. A pair is not a wall, and collapsing it
    would hide two real rows to save one line — the ledger should only be
    summarised where the summary is genuinely easier to read than the thing it
    replaces.
  */
  const runsByDay = useMemo(
    () =>
      groups.map((g) => {
        const runs: Array<{ key: string; kind: TxKind; items: TxRow[] }> = []
        for (const row of g.items) {
          const last = runs[runs.length - 1]
          if (last && last.kind === row.kind) last.items.push(row)
          else runs.push({ key: `${g.label}-${runs.length}`, kind: row.kind, items: [row] })
        }
        return { label: g.label, runs }
      }),
    [groups],
  )

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
          {/* A crypto withdrawal is denominated in the coin it was paid in.
              Cedis are for mobile money — showing a cedi figure against a
              USDT payout describes a transfer that never happened in cedis. */}
          {r.coinAmount !== undefined && r.coin
            ? `≈ ${format.number(r.coinAmount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.coin}`
            : `≈ GHS ${format.number(r.ghs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
        {runsByDay.map((g) => (
          <div key={g.label}>
            <p className="bg-ink-50 px-4 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
              {g.label}
            </p>
            <ul className="divide-y divide-ink-100">
              {g.runs.map((run) => {
                const single = run.items.length < 3
                const isOpen = opened.has(run.key)

                /* Fewer than three, or already opened: the real rows. */
                if (single || isOpen) {
                  return (
                    <li key={run.key}>
                      {!single && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpened((prev) => {
                              const next = new Set(prev)
                              next.delete(run.key)
                              return next
                            })
                          }
                          className="flex w-full items-center gap-1.5 px-4 pt-3 text-[0.6875rem] font-semibold text-brand-700"
                        >
                          <ChevronDown aria-hidden className="size-3.5" />
                          {t('collapse')}
                        </button>
                      )}
                      <ul className="divide-y divide-ink-100">
                        {run.items.map((r) => (
                          <li
                            key={r.id}
                            className="flex items-center justify-between gap-3 px-4 py-3"
                          >
                            {identity(r)}
                            <div className="shrink-0 text-right">
                              {amountCell(r)}
                              <p className="mt-0.5 text-[0.625rem] tabular-nums text-ink-400">
                                {format.dateTime(new Date(r.at), {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                                {r.balanceAfter !== null &&
                                  ` · ${t('balanceShort', { balance: format.number(r.balanceAfter) })}`}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                }

                /* Three or more: one line, and the total. */
                const total = run.items.reduce((n, r) => n + (r.points ?? 0), 0)
                return (
                  <li key={run.key}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpened((prev) => new Set(prev).add(run.key))
                      }
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {(() => {
                          /* Same chip treatment `identity` gives a single row,
                             so a rolled-up line sits in the list rather than
                             looking like a different kind of thing. */
                          const Icon = iconFor(run.items[0]!)
                          return (
                            <span
                              className={cn(
                                'grid size-9 shrink-0 place-items-center rounded-full',
                                KIND_CHIP[run.kind],
                              )}
                            >
                              <Icon aria-hidden className="size-4" />
                            </span>
                          )
                        })()}
                        <span className="min-w-0">
                          <span className="block truncate text-[0.8125rem] font-medium text-ink-900">
                            {t(`kind.${run.kind}`)}
                          </span>
                          <span className="flex items-center gap-1 text-[0.6875rem] text-ink-500">
                            {t('runCount', { n: run.items.length })}
                            <ChevronRight aria-hidden className="size-3" />
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={cn(
                            'block text-[0.8125rem] font-semibold tabular-nums',
                            total >= 0 ? 'text-success-700' : 'text-danger-600',
                          )}
                        >
                          {total >= 0 ? '+' : ''}
                          {format.number(total)} {t('pts')}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
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
            {/*
              THE SAME ROLL-UP AS THE PHONE FEED.

              A statement is allowed to list every line — but this one is on a
              DASHBOARD, where fifteen rows of "Ads / Ad reward" pushed
              everything else off the screen and said one thing fifteen times.
              Rolled up it is still a complete statement: nothing is dropped,
              and one click opens any run.

              The running-balance column is deliberately blank on a collapsed
              row. A single balance cannot describe eight entries, and printing
              the last one would look like the balance for the whole run.
            */}
            <tbody className="divide-y divide-ink-100">
              {runsByDay.flatMap((g) =>
                g.runs.map((run) => {
                  const single = run.items.length < 3
                  const isOpen = opened.has(run.key)

                  if (single || isOpen) {
                    return run.items.map((r, i) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3">
                          {identity(r)}
                          {!single && i === 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setOpened((prev) => {
                                  const next = new Set(prev)
                                  next.delete(run.key)
                                  return next
                                })
                              }
                              className="mt-1 flex items-center gap-1 text-[0.6875rem] font-semibold text-brand-700"
                            >
                              <ChevronDown aria-hidden className="size-3" />
                              {t('collapse')}
                            </button>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <p className="text-[0.8125rem] text-ink-700">
                            {format.dateTime(new Date(r.at), {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
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
                    ))
                  }

                  const total = run.items.reduce((n, r) => n + (r.points ?? 0), 0)
                  const first = run.items[run.items.length - 1]!
                  const Icon = iconFor(run.items[0]!)
                  return (
                    <tr
                      key={run.key}
                      onClick={() => setOpened((prev) => new Set(prev).add(run.key))}
                      className="cursor-pointer transition-colors hover:bg-ink-50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={cn(
                              'grid size-9 shrink-0 place-items-center rounded-full',
                              KIND_CHIP[run.kind],
                            )}
                          >
                            <Icon aria-hidden className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[0.8125rem] font-medium text-ink-900">
                              {t(`kind.${run.kind}`)}
                            </p>
                            <p className="flex items-center gap-1 text-[0.6875rem] text-brand-700">
                              {t('runCount', { n: run.items.length })}
                              <ChevronRight aria-hidden className="size-3" />
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="text-[0.8125rem] text-ink-700">
                          {format.dateTime(new Date(first.at), {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p
                          className={cn(
                            'text-right text-[0.8125rem] font-semibold tabular-nums',
                            total >= 0 ? 'text-success-700' : 'text-danger-600',
                          )}
                        >
                          {total >= 0 ? '+' : ''}
                          {format.number(total)} {t('pts')}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-[0.8125rem] text-ink-400">
                        —
                      </td>
                    </tr>
                  )
                }),
              )}
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
