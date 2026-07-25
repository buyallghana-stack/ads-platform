'use client'

import { useEffect, useMemo, useState } from 'react'

import { Check, Clock, Coins, Gavel, Smartphone, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  DISPUTE_WINDOW_HOURS,
  canDispute,
  type PayoutRequest,
  type PayoutStatus,
} from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusPill } from './AdminChrome'
import { PAYOUT_TONE } from './payout-status'

/**
 * The payout queue — the screen the whole admin area exists for, because
 * nobody gets paid until somebody presses a button here.
 *
 * Desktop is the table from reference 3: identity as a two-line block, then
 * the money, then state, then the action. Below lg it becomes a card list —
 * a nine-column table on a phone is a table nobody reads, and approving a
 * payout from a phone is a thing that will genuinely happen.
 *
 * THE DISPUTE RULE (operator, 2026-07-25)
 * A dispute can only be raised on a payout already marked paid, and only
 * within 48 hours of that status change. After the window it is GONE from
 * the row rather than greyed out: an action that can never succeed should
 * not keep taking up space and inviting a click.
 *
 * Every decision here is local state only. The backend lands later; when it
 * does, `decide` becomes a server action and nothing else about this file
 * changes.
 */

type Filter = 'queue' | 'all' | PayoutStatus

const FILTERS: Filter[] = ['queue', 'all', 'paid', 'disputed', 'rejected']

export function PayoutsTable({
  initial,
  serverNow,
}: {
  initial: PayoutRequest[]
  /** The server's clock at render. Seeding from it keeps the first client
   *  paint identical to the server's — computing Date.now() on both sides is
   *  a hydration mismatch, and this table renders time-dependent buttons. */
  serverNow: number
}) {
  const t = useTranslations('admin.payouts')
  const ts = useTranslations('admin.overview.status')
  const format = useFormatter()

  const [rows, setRows] = useState(initial)

  /* Ticks every minute so a dispute window genuinely closes while the
     operator is looking at it, rather than only on reload. */
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const [filter, setFilter] = useState<Filter>('queue')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (filter === 'queue') return r.status === 'pending_approval' || r.status === 'held'
        if (filter === 'all') return true
        return r.status === filter
      })
      .filter((r) => {
        if (!q) return true
        return [r.user.name, r.user.email, r.reference, r.destination]
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
  }, [rows, filter, query])

  /** Local only, until the backend exists. */
  const decide = (id: string, status: PayoutStatus) =>
    setRows((all) =>
      all.map((r) =>
        r.id === id ? { ...r, status, statusChangedAt: new Date().toISOString() } : r,
      ),
    )

  const ghs = (n: number) =>
    `GHS ${format.number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  /** The buttons a row is entitled to, given where it is. */
  function actionsFor(r: PayoutRequest) {
    const acts: { key: string; label: string; icon: React.ReactNode; tone: string; next: PayoutStatus }[] = []

    if (r.status === 'pending_approval' || r.status === 'held') {
      acts.push({
        key: 'approve', label: t('actions.approve'), icon: <Check />, next: 'approved',
        tone: 'border-success-500/30 bg-success-50 text-success-700 hover:border-success-500/60',
      })
      if (r.status !== 'held') {
        acts.push({
          key: 'hold', label: t('actions.hold'), icon: <Clock />, next: 'held',
          tone: 'border-warning-500/30 bg-warning-50 text-warning-600 hover:border-warning-500/60',
        })
      }
      acts.push({
        key: 'decline', label: t('actions.decline'), icon: <X />, next: 'rejected',
        tone: 'border-danger-500/25 bg-danger-50 text-danger-700 hover:border-danger-500/50',
      })
    }

    if (r.status === 'approved') {
      acts.push({
        key: 'paid', label: t('actions.markPaid'), icon: <Check />, next: 'paid',
        tone: 'border-success-500/30 bg-success-50 text-success-700 hover:border-success-500/60',
      })
    }

    // Only while the window is open. See the note at the top.
    if (canDispute(r, now)) {
      acts.push({
        key: 'dispute', label: t('actions.dispute'), icon: <Gavel />, next: 'disputed',
        tone: 'border-violet-600/25 bg-violet-50 text-violet-700 hover:border-violet-600/50',
      })
    }

    return acts
  }

  const hoursLeft = (r: PayoutRequest) => {
    const elapsed = (now - new Date(r.statusChangedAt).getTime()) / 3_600_000
    return Math.max(0, Math.ceil(DISPUTE_WINDOW_HOURS - elapsed))
  }

  const MethodIcon = ({ method }: { method: PayoutRequest['method'] }) =>
    method === 'crypto' ? (
      <Coins aria-hidden className="size-3.5 text-teal-600" />
    ) : (
      <Smartphone aria-hidden className="size-3.5 text-brand-600" />
    )

  const ActionButtons = ({ r, block }: { r: PayoutRequest; block?: boolean }) => {
    const acts = actionsFor(r)
    if (acts.length === 0) {
      return <span className="text-[0.75rem] text-ink-400">{t('noActions')}</span>
    }
    return (
      <div className={cn('flex flex-wrap gap-1.5', block && 'w-full')}>
        {acts.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => decide(r.id, a.next)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-(--radius-input) border px-2.5 py-1.5',
              'text-[0.75rem] font-semibold transition-colors',
              'pointer-coarse:py-2',
              block && 'flex-1 justify-center',
              a.tone,
            )}
          >
            <span aria-hidden className="[&>svg]:size-3.5">{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* ---- Filters + search ---------------------------------------- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('filterLabel')}>
          {FILTERS.map((f) => {
            const n =
              f === 'queue'
                ? rows.filter((r) => r.status === 'pending_approval' || r.status === 'held').length
                : f === 'all'
                  ? rows.length
                  : rows.filter((r) => r.status === f).length
            return (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5',
                  'text-[0.75rem] font-medium transition-colors',
                  filter === f
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-ink-200 bg-surface text-ink-600 hover:border-ink-300',
                )}
              >
                {f === 'queue' ? t('filters.queue') : f === 'all' ? t('filters.all') : ts(f)}
                <span className="tabular-nums opacity-70">{n}</span>
              </button>
            )
          })}
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="h-9 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none sm:ml-auto sm:w-64"
        />
      </div>

      {visible.length === 0 && (
        <p className="rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-12 text-center text-[0.8125rem] text-ink-400">
          {t('empty')}
        </p>
      )}

      {/* ---- Table, lg and up ---------------------------------------- */}
      {visible.length > 0 && (
        <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] lg:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50/60 text-left">
                {['reference', 'user', 'amount', 'destination', 'status', 'requested', 'action'].map(
                  (c) => (
                    <th
                      key={c}
                      className="px-4 py-2.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-ink-500 uppercase"
                    >
                      {t(`columns.${c}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200/70">
              {visible.map((r) => (
                <tr key={r.id} className="align-middle hover:bg-ink-50/50">
                  <td className="px-4 py-3">
                    <span className="text-[0.8125rem] font-medium text-ink-700 tabular-nums">
                      {r.reference}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <PersonCell name={r.user.name} secondary={r.user.email} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                      {ghs(r.ghs)}
                    </p>
                    <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                      {r.points.toLocaleString()} pts
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[0.75rem] text-ink-600">
                      <MethodIcon method={r.method} />
                      {r.destination}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={PAYOUT_TONE[r.status]}>{ts(r.status)}</StatusPill>
                    {canDispute(r, now) && (
                      <p className="mt-1 text-[0.625rem] text-ink-400">
                        {t('disputeWindow', { hours: hoursLeft(r) })}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[0.75rem] text-ink-500">
                      {format.relativeTime(new Date(r.requestedAt), now)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ActionButtons r={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Cards, below lg ----------------------------------------- */}
      {visible.length > 0 && (
        <ul className="flex flex-col gap-2.5 lg:hidden">
          {visible.map((r) => (
            <li
              key={r.id}
              className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
            >
              <div className="flex items-start justify-between gap-3">
                <PersonCell name={r.user.name} secondary={r.reference} size="md" />
                <div className="shrink-0 text-right">
                  <p className="text-[0.9375rem] font-bold text-ink-900 tabular-nums">
                    {ghs(r.ghs)}
                  </p>
                  <StatusPill tone={PAYOUT_TONE[r.status]} className="mt-1">
                    {ts(r.status)}
                  </StatusPill>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-200 pt-2.5">
                <span className="inline-flex items-center gap-1.5 truncate font-mono text-[0.6875rem] text-ink-500">
                  <MethodIcon method={r.method} />
                  {r.destination}
                </span>
                <span className="shrink-0 text-[0.6875rem] text-ink-400">
                  {format.relativeTime(new Date(r.requestedAt), now)}
                </span>
              </div>

              {canDispute(r, now) && (
                <p className="mt-2 text-[0.6875rem] text-violet-700">
                  {t('disputeWindow', { hours: hoursLeft(r) })}
                </p>
              )}

              <div className="mt-3">
                <ActionButtons r={r} block />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
