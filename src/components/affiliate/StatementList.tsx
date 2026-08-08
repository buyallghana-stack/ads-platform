'use client'

import { useMemo, useState } from 'react'

import {
  ChevronDown,
  ChevronRight,
  Clock,
  Gamepad2,
  RotateCcw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Target,
  Ticket,
  Users,
  Wrench,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { StatementEntry, StatementKind } from '@/lib/market/data'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * The commission statement.
 *
 * ── THE SAME STATEMENT AS THE POINTS ONE, IN CEDIS ──
 *
 * Operator, 2026-08-08: it should resemble the ads history in logic and
 * display. So it is the same pattern, feature for feature — search, kind
 * filter, sort, days as headings, runs of one kind rolled into a line, a feed
 * on a phone and a table with a running balance from md. A user who holds both
 * businesses learns one statement.
 *
 * ── WHAT IS NOT THE SAME, AND WHY ──
 *
 * The two businesses do not do the same things, so the KINDS differ and the
 * icons with them. There are no ads, no surveys and no articles here; there
 * are SALES and REFERRALS, which the points side has no equivalent of. Games,
 * gift codes and tasks exist on both, so those three keep the icon and the
 * tint they have on the ads statement — the same event should not look like
 * two different events depending which business you are standing in.
 *
 * The amounts are cedis, not points, and there is no second line converting
 * them: commission already IS money. The points statement needs that line
 * because a point is not a unit anybody budgets in.
 *
 * ── D27 ──
 *
 * A near-copy rather than a shared component, deliberately. The two render
 * different units from different tables with different kinds, and a shared
 * one would need a discriminator threaded through every branch — which is how
 * a points figure ends up on a cedis screen.
 */

const KIND_ORDER: StatementKind[] = [
  'sale',
  'referral',
  'game',
  'gift',
  'task',
  'payout',
  'reversal',
  'adjustment',
]

const KIND_ICON: Record<StatementKind, React.ComponentType<{ className?: string }>> = {
  /* A sale is a purchase somebody made through your link. */
  sale: ShoppingBag,
  /* A referral is an override on a sale made by somebody you brought in, so
     the icon is people rather than a product. */
  referral: Users,
  game: Gamepad2,
  /* A voucher, not a present — the same reasoning and the same glyph as the
     points statement. */
  gift: Ticket,
  task: Target,
  payout: Smartphone,
  reversal: RotateCcw,
  adjustment: Wrench,
}

/**
 * Meaning-coded tints, matching the points statement where the meaning
 * matches: money in is green, luck is violet, something you set up is teal,
 * money leaving is brand, a correction is neutral.
 */
const KIND_CHIP: Record<StatementKind, string> = {
  sale: 'bg-success-500/15 text-success-600',
  /* Green too. A referral override is money in from a sale, exactly like a
     sale; the icon and label carry the difference, not the colour. */
  referral: 'bg-success-500/15 text-success-600',
  game: 'bg-violet-500/15 text-violet-600',
  gift: 'bg-orange-500/15 text-orange-600',
  task: 'bg-teal-500/15 text-teal-600',
  payout: 'bg-brand-600/15 text-brand-700',
  /* The one that is NOT the points statement's palette, and deliberately: a
     reversal takes money back, and there is no equivalent on the points side.
     Red is the honest colour for it. */
  reversal: 'bg-danger-500/15 text-danger-600',
  adjustment: 'bg-ink-100 text-ink-500',
}

type SortKey = 'newest' | 'oldest' | 'largest' | 'smallest'

export function StatementList({ entries }: { entries: StatementEntry[] }) {
  const t = useTranslations('affiliate.statement')
  const format = useFormatter()

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<StatementKind | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [limit, setLimit] = useState(15)
  const [opened, setOpened] = useState<Set<string>>(new Set())

  const kindsPresent = useMemo(
    () => KIND_ORDER.filter((k) => entries.some((e) => e.kind === k)),
    [entries],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .filter((e) => kind === 'all' || e.kind === kind)
      .filter((e) => {
        if (!q) return true
        return [t(`kind.${e.kind}`), e.product_title ?? '', e.reason ?? '', cedis(e.amount_minor)]
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => {
        switch (sort) {
          case 'newest':
            return a.created_at < b.created_at ? 1 : -1
          case 'oldest':
            return a.created_at > b.created_at ? 1 : -1
          case 'largest':
            return Math.abs(b.amount_minor) - Math.abs(a.amount_minor)
          case 'smallest':
            return Math.abs(a.amount_minor) - Math.abs(b.amount_minor)
        }
      })
  }, [entries, query, kind, sort, t])

  const visible = filtered.slice(0, limit)

  const groups = useMemo(() => {
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 86400000).toDateString()
    const out: Array<{ label: string; items: StatementEntry[] }> = []
    for (const row of visible) {
      const d = new Date(row.created_at)
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

  /* Runs of the same kind within one day, rolled into a line at three or more.
     Same threshold and same reasoning as the points statement: a pair is not a
     wall, and collapsing it would hide two real rows to save one line. An
     affiliate who wins six games in an evening should not have to scroll past
     six near-identical rows to find the sale above them. */
  const runsByDay = useMemo(
    () =>
      groups.map((g) => {
        const runs: Array<{ key: string; kind: StatementKind; items: StatementEntry[] }> = []
        for (const row of g.items) {
          const last = runs[runs.length - 1]
          if (last && last.kind === row.kind) last.items.push(row)
          else runs.push({ key: `${g.label}-${runs.length}`, kind: row.kind, items: [row] })
        }
        return { label: g.label, runs }
      }),
    [groups],
  )

  const amountCell = (e: StatementEntry) => (
    <p
      className={cn(
        'text-right text-[0.8125rem] font-semibold tabular-nums',
        e.amount_minor >= 0 ? 'text-success-700' : 'text-ink-900',
        e.kind === 'reversal' && 'text-danger-600',
        /* A pending credit is dimmed rather than coloured: it is real, it is
           just not spendable, and full green on a figure that cannot be
           withdrawn is a promise the balance does not keep. */
        e.status === 'pending' && 'opacity-60',
      )}
    >
      {e.amount_minor >= 0 ? '+' : '−'}
      {cedis(Math.abs(e.amount_minor))}
    </p>
  )

  const identity = (e: StatementEntry) => {
    const Icon = KIND_ICON[e.kind]
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', KIND_CHIP[e.kind])}>
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] font-medium text-ink-900">
            <span className="truncate">{t(`kind.${e.kind}`)}</span>
            {/* Level two is on the row rather than in a legend: the obvious
                question about a smaller-than-expected entry is answered
                entirely by which level it was. */}
            {e.level === 2 && (
              <span className="rounded-full bg-brand-600/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-brand-700">
                {t('levelTwo')}
              </span>
            )}
          </p>
          <p className="truncate text-[0.6875rem] text-ink-400">
            {e.product_title ?? e.reason ?? t(`kindHint.${e.kind}`)}
          </p>
          {e.status === 'pending' && e.clears_at && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[0.6875rem] text-warning-600">
              <Clock aria-hidden className="size-3" />
              {t('clearsOn', {
                date: format.dateTime(new Date(e.clears_at), { day: 'numeric', month: 'short' }),
              })}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ---- controls ------------------------------------------------- */}
      <div className="flex flex-col gap-2.5 border-b border-ink-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="h-8 w-full rounded-(--radius-input) border border-ink-200 bg-surface pl-8 pr-3 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 hover:border-ink-300 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12 focus:outline-none pointer-coarse:h-10 pointer-coarse:text-base"
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
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
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
                onClick={() => {
                  setKind(k as StatementKind | 'all')
                  setLimit(15)
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[0.75rem] font-medium transition-colors',
                  kind === k
                    ? 'border-brand-600 bg-brand-600/12 text-brand-700'
                    : 'border-ink-200 text-ink-500 hover:border-ink-300 hover:text-ink-700',
                )}
              >
                {k === 'all' ? t('allTypes') : t(`kind.${k}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="px-4 py-10 text-center text-[0.8125rem] text-ink-400">
          {entries.length === 0 ? t('empty') : t('emptyFiltered')}
        </p>
      )}

      {/* ---- phone: a feed grouped by day ------------------------------ */}
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
                        {run.items.map((e) => (
                          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                            {identity(e)}
                            <div className="shrink-0 text-right">
                              {amountCell(e)}
                              <p className="mt-0.5 text-[0.625rem] tabular-nums text-ink-400">
                                {format.dateTime(new Date(e.created_at), {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                                {` · ${t('balanceShort', { balance: cedis(e.balance_after) })}`}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                }

                const total = run.items.reduce((n, e) => n + e.amount_minor, 0)
                return (
                  <li key={run.key}>
                    <button
                      type="button"
                      onClick={() => setOpened((prev) => new Set(prev).add(run.key))}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {(() => {
                          const Icon = KIND_ICON[run.kind]
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
                      <span
                        className={cn(
                          'shrink-0 text-[0.8125rem] font-semibold tabular-nums',
                          total >= 0 ? 'text-success-700' : 'text-danger-600',
                        )}
                      >
                        {total >= 0 ? '+' : '−'}
                        {cedis(Math.abs(total))}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* ---- md+: a table with the running balance --------------------- */}
      {visible.length > 0 && (
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ink-200 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
                <th className="px-4 py-2.5 font-semibold">{t('columns.entry')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('columns.date')}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t('columns.amount')}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t('columns.balance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {runsByDay.flatMap((g) =>
                g.runs.map((run) => {
                  const single = run.items.length < 3
                  const isOpen = opened.has(run.key)

                  if (single || isOpen) {
                    return run.items.map((e, i) => (
                      <tr key={e.id}>
                        <td className="px-4 py-3">
                          {identity(e)}
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
                            {format.dateTime(new Date(e.created_at), {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </p>
                          <p className="text-[0.6875rem] tabular-nums text-ink-400">
                            {format.dateTime(new Date(e.created_at), {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{amountCell(e)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-[0.8125rem] tabular-nums text-ink-700">
                          {cedis(e.balance_after)}
                        </td>
                      </tr>
                    ))
                  }

                  const total = run.items.reduce((n, e) => n + e.amount_minor, 0)
                  const oldest = run.items[run.items.length - 1]!
                  const Icon = KIND_ICON[run.kind]
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
                      <td className="whitespace-nowrap px-4 py-3 text-[0.8125rem] text-ink-700">
                        {format.dateTime(new Date(oldest.created_at), {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p
                          className={cn(
                            'text-right text-[0.8125rem] font-semibold tabular-nums',
                            total >= 0 ? 'text-success-700' : 'text-danger-600',
                          )}
                        >
                          {total >= 0 ? '+' : '−'}
                          {cedis(Math.abs(total))}
                        </p>
                      </td>
                      {/* Blank on a rolled-up row. One balance cannot describe
                          six entries, and printing the last would look like the
                          balance for the whole run. */}
                      <td className="whitespace-nowrap px-4 py-3 text-right text-[0.8125rem] text-ink-400">
                        {t('collapsedBalance')}
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
