'use client'

import { useEffect, useMemo, useState } from 'react'

import { Check, Clock, Coins, Gavel, PanelRight, Search, Smartphone, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import { maskDestination } from '@/lib/admin/destination'
import { DISPUTE_WINDOW_HOURS, canDispute, type PayoutRequest, type PayoutStatus } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import { PayoutDrawer } from './PayoutDrawer'
import { ACTION_RULES, availableActions, bulkEligible, type PayoutAction } from './payout-actions'
import { PAYOUT_TONE } from './payout-status'

/**
 * The payout queue — the screen the whole admin area exists for, because
 * nobody gets paid until somebody presses a button here.
 *
 * WHAT THE REBUILD FIXED (operator, 2026-07-25)
 * The first version put every action on every row as a labelled button. Three
 * buttons per row meant the row's widest, loudest element was its controls;
 * rows changed shape depending on their state, so nothing lined up down the
 * column; and on a phone the buttons wrapped into a block taller than the
 * payout itself. It read as work rather than as a list.
 *
 * The rebuild splits the screen by what each part is for:
 *
 *   TRIAGE   the row. Who, how much, where to, how old, what state. Enough
 *            to decide whether this one needs looking at, nothing more.
 *   DECIDE   the review panel. Everything that answers "should I pay this?"
 *            — the risk reasons, the account-name check, whether the wallet
 *            is shared with other accounts — and the full-size buttons.
 *   REPEAT   the overflow menu and the selection bar, for the payouts an
 *            operator has already decided about at a glance. A clean MoMo
 *            payout to a returning user does not deserve a panel.
 *
 * DESTINATIONS ARE MASKED. Every account number and wallet address in this
 * table is masked by `maskDestination`, and there is deliberately no way to
 * unmask one from the row — the reveal lives in the panel, one payout at a
 * time, and re-masks itself. A queue of thirty full phone numbers is a
 * screenshot waiting to happen.
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

/* Only the states that actually occur get a tab. `cancelled` and `failed`
   exist in the type because the database has them, but a tab that is always
   empty is a tab that teaches the operator to ignore the tab row. */
const FILTERS: Filter[] = ['queue', 'approved', 'paid', 'disputed', 'rejected', 'all']

const ACTION_ICON: Record<PayoutAction, React.ReactNode> = {
  approve: <Check />,
  hold: <Clock />,
  decline: <X />,
  markPaid: <Check />,
  dispute: <Gavel />,
}

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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)

  const inQueue = (r: PayoutRequest) => r.status === 'pending_approval' || r.status === 'held'

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => (filter === 'queue' ? inQueue(r) : filter === 'all' ? true : r.status === filter))
      .filter((r) => {
        if (!q) return true
        /* Searching matches the MASKED destination, not the full one —
           otherwise typing a full phone number into the box would confirm
           whether that number is in the system, which is the same disclosure
           the mask exists to prevent. The last digits still find the row,
           which is what an operator actually searches by. */
        return [r.user.name, r.user.email, r.reference, r.provider, maskDestination(r)]
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
  }, [rows, filter, query])

  /** Local only, until the backend exists. */
  const decide = (id: string, action: PayoutAction, reason: string) => {
    const next = ACTION_RULES[action].next
    setRows((all) =>
      all.map((r) =>
        r.id === id
          ? {
              ...r,
              status: next,
              statusChangedAt: new Date().toISOString(),
              // Kept rather than discarded: the user is shown this, so the
              // next operator to open the request must see it too.
              decisionNote: reason || r.decisionNote,
            }
          : r,
      ),
    )
    setSelected((s) => {
      if (!s.has(id)) return s
      const copy = new Set(s)
      copy.delete(id)
      return copy
    })
  }

  const decideMany = (ids: string[], action: PayoutAction) => {
    const next = ACTION_RULES[action].next
    const set = new Set(ids)
    setRows((all) =>
      all.map((r) =>
        set.has(r.id) ? { ...r, status: next, statusChangedAt: new Date().toISOString() } : r,
      ),
    )
    setSelected(new Set())
  }

  const ghs = (n: number) =>
    `GHS ${format.number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  /* ---- The three numbers above the queue --------------------------- */
  const summary = useMemo(() => {
    const sum = (list: PayoutRequest[]) => list.reduce((n, r) => n + r.ghs, 0)
    const waiting = rows.filter(inQueue)
    const approved = rows.filter((r) => r.status === 'approved')
    const paidToday = rows.filter(
      (r) => r.status === 'paid' && now - new Date(r.statusChangedAt).getTime() < 24 * 3_600_000,
    )
    return {
      waiting: { count: waiting.length, ghs: sum(waiting) },
      approved: { count: approved.length, ghs: sum(approved) },
      paidToday: { count: paidToday.length, ghs: sum(paidToday) },
    }
  }, [rows, now])

  /* ---- Selection ---------------------------------------------------- */
  const selectable = visible.filter((r) => availableActions(r, now).length > 0)
  const selectedRows = rows.filter((r) => selected.has(r.id))
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id))

  const toggle = (id: string) =>
    setSelected((s) => {
      const copy = new Set(s)
      if (copy.has(id)) copy.delete(id)
      else copy.add(id)
      return copy
    })

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))

  const hoursLeft = (r: PayoutRequest) => {
    const elapsed = (now - new Date(r.statusChangedAt).getTime()) / 3_600_000
    return Math.max(0, Math.ceil(DISPUTE_WINDOW_HOURS - elapsed))
  }

  /** The row's menu: review first, then the decisions, destructive last. */
  const menuFor = (r: PayoutRequest): MenuItem[] => {
    const acts = availableActions(r, now)
    const items: MenuItem[] = [
      {
        key: 'review',
        label: t('actions.review'),
        icon: <PanelRight />,
        onSelect: () => setOpenId(r.id),
      },
    ]

    acts
      .slice()
      .sort((a, b) => Number(ACTION_RULES[a].destructive) - Number(ACTION_RULES[b].destructive))
      .forEach((a, i, sorted) => {
        const rule = ACTION_RULES[a]
        items.push({
          key: a,
          label: t(`actions.${a}`),
          icon: ACTION_ICON[a],
          tone: rule.destructive ? 'danger' : 'default',
          // A divider under "Review", and another above the first
          // destructive action so Decline is never adjacent to Approve.
          separated: i === 0 || (rule.destructive && !ACTION_RULES[sorted[i - 1]!].destructive),
          /* Anything that needs a reason or a confirmation opens the panel
             rather than firing from the menu. A menu item is one click from a
             mis-aim, and "Decline" one click from "Approve" on a money screen
             is not a risk worth taking for the keystroke it saves. */
          hint: rule.confirm || rule.reason ? t('actions.opensPanel') : undefined,
          onSelect: () => (rule.confirm || rule.reason ? setOpenId(r.id) : decide(r.id, a, '')),
        })
      })

    return items
  }

  const MethodIcon = ({ method }: { method: PayoutRequest['method'] }) =>
    method === 'crypto' ? (
      <Coins aria-hidden className="size-3.5 shrink-0 text-teal-600" />
    ) : (
      <Smartphone aria-hidden className="size-3.5 shrink-0 text-brand-600" />
    )

  /** Masked destination, one shape for the table and the cards. */
  const Destination = ({ r }: { r: PayoutRequest }) => (
    <span className="flex min-w-0 items-center gap-1.5">
      <MethodIcon method={r.method} />
      <span className="min-w-0">
        <span className="block truncate font-mono text-[0.75rem] tracking-[0.04em] text-ink-700">
          {maskDestination(r)}
        </span>
        <span className="block truncate text-[0.625rem] text-ink-400">{r.provider}</span>
      </span>
    </span>
  )

  const open = rows.find((r) => r.id === openId) ?? null

  return (
    <div>
      {/* ---- Summary strip -------------------------------------------
          Three numbers, hairline-separated rather than three cards. The
          operator already has metric cards on the overview; repeating that
          treatment here would make the queue — the actual work — the second
          thing on the page. */}
      <div className="mb-5 grid grid-cols-3 divide-x divide-ink-200 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface">
        <SummaryCell
          label={t('summary.waiting')}
          count={summary.waiting.count}
          value={ghs(summary.waiting.ghs)}
          emphasis={summary.waiting.count > 0}
        />
        <SummaryCell
          label={t('summary.approved')}
          count={summary.approved.count}
          value={ghs(summary.approved.ghs)}
        />
        <SummaryCell
          label={t('summary.paidToday')}
          count={summary.paidToday.count}
          value={ghs(summary.paidToday.ghs)}
        />
      </div>

      {/* ---- Tabs + search --------------------------------------------
          Underline tabs, not pills. The filters are one exclusive choice, and
          a row of pills reads as a row of buttons that might each be on or
          off — the same ambiguity the action buttons had. */}
      <div className="mb-3 flex flex-col gap-3 border-b border-ink-200 sm:flex-row sm:items-end sm:justify-between">
        <div
          role="tablist"
          aria-label={t('filterLabel')}
          className={cn(
            '-mb-px flex min-w-0 gap-1 overflow-x-auto pr-4',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            /* Fades the last tab out as it runs off rather than letting it be
               chopped flat against the search field, which reads as an
               overlap bug instead of as "there is more this way". */
            '[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]',
          )}
        >
          {FILTERS.map((f) => {
            const n =
              f === 'queue'
                ? rows.filter(inQueue).length
                : f === 'all'
                  ? rows.length
                  : rows.filter((r) => r.status === f).length
            const active = filter === f
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setFilter(f)
                  setSelected(new Set())
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5',
                  'text-[0.8125rem] font-medium whitespace-nowrap transition-colors',
                  'focus-visible:outline-none focus-visible:bg-ink-50',
                  active
                    ? 'border-ink-900 text-ink-900'
                    : 'border-transparent text-ink-500 hover:text-ink-900',
                )}
              >
                {f === 'queue' ? t('filters.queue') : f === 'all' ? t('filters.all') : ts(f)}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[0.6875rem] tabular-nums',
                    /* text-canvas, not text-white: the dark theme remaps
                       ink-900 to a near-white, so a hard white here vanished
                       into its own chip. Both tokens flip together. */
                    active ? 'bg-ink-900 text-canvas' : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {n}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative mb-2.5 sm:mb-2 sm:w-60">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="h-9 w-full rounded-(--radius-input) border border-ink-200 bg-surface pr-3 pl-8 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
          />
        </div>
      </div>

      {visible.length === 0 && (
        <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-16 text-center text-[0.8125rem] text-ink-400">
          {filter === 'queue' ? t('emptyQueue') : t('empty')}
        </p>
      )}

      {/* ---- Table, lg and up ------------------------------------------ */}
      {visible.length > 0 && (
        <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface lg:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ink-200 text-left">
                <th scope="col" className="w-10 py-2.5 pl-4">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={toggleAll}
                    aria-label={t('selectAll')}
                    className="size-4 cursor-pointer appearance-none rounded-[4px] border border-ink-300 bg-surface checked:border-brand-600 checked:bg-brand-600 checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22white%22 stroke-width=%223%22><path d=%22M3.5 8.5l3 3 6-6%22/></svg>')] checked:bg-center checked:bg-no-repeat disabled:opacity-40"
                  />
                </th>
                {(['user', 'amount', 'destination', 'status', 'requested'] as const).map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn(
                      'px-4 py-2.5 text-[0.6875rem] font-medium tracking-[0.04em] text-ink-400 uppercase',
                      c === 'amount' && 'text-right',
                    )}
                  >
                    {t(`columns.${c}`)}
                  </th>
                ))}
                <th scope="col" className="w-12 py-2.5 pr-3">
                  <span className="sr-only">{t('columns.action')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {visible.map((r) => {
                const isSelected = selected.has(r.id)
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      'relative align-middle transition-colors',
                      isSelected ? 'bg-brand-50/50' : 'hover:bg-ink-50/60',
                      openId === r.id && 'bg-ink-50',
                    )}
                  >
                    <td className="py-3 pl-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={availableActions(r, now).length === 0}
                        onChange={() => toggle(r.id)}
                        aria-label={t('selectRow', { reference: r.reference })}
                        className="relative z-10 size-4 cursor-pointer appearance-none rounded-[4px] border border-ink-300 bg-surface checked:border-brand-600 checked:bg-brand-600 checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22white%22 stroke-width=%223%22><path d=%22M3.5 8.5l3 3 6-6%22/></svg>')] checked:bg-center checked:bg-no-repeat disabled:cursor-default disabled:opacity-30"
                      />
                    </td>

                    <td className="px-4 py-3">
                      {/* The stretched control: a real button with a real
                          name, whose ::after covers the row. Keyboard and
                          screen-reader users get one focusable "review this
                          payout" per row; mouse users get a clickable row.
                          A tr with an onClick gives neither. */}
                      <button
                        type="button"
                        onClick={() => setOpenId(r.id)}
                        className="block w-full text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-600 focus-visible:after:ring-inset"
                      >
                        <span className="sr-only">
                          {t('reviewRow', { reference: r.reference, name: r.user.name })}
                        </span>
                        <PersonCell name={r.user.name} avatarUrl={r.user.avatarUrl} />
                      </button>
                      <p className="mt-1 pl-[2.625rem] font-mono text-[0.6875rem] text-ink-400">
                        {r.reference}
                      </p>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <p className="text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                        {ghs(r.ghs)}
                      </p>
                      <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                        {r.points.toLocaleString()} pts
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <Destination r={r} />
                    </td>

                    <td className="px-4 py-3">
                      <StatusDot tone={PAYOUT_TONE[r.status]}>{ts(r.status)}</StatusDot>
                      {canDispute(r, now) && (
                        <p className="mt-0.5 text-[0.625rem] text-ink-400">
                          {t('disputeWindow', { hours: hoursLeft(r) })}
                        </p>
                      )}
                      {r.risk !== 'low' && (
                        <p className="mt-0.5 text-[0.625rem] font-medium text-warning-600">
                          {t(`riskLevel.${r.risk}`)}
                        </p>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span className="text-[0.75rem] whitespace-nowrap text-ink-500">
                        {format.relativeTime(new Date(r.requestedAt), now)}
                      </span>
                    </td>

                    <td className="py-3 pr-3 text-right">
                      <span className="relative z-10 inline-flex">
                        <MoreMenu
                          label={t('menuLabel', { reference: r.reference })}
                          items={menuFor(r)}
                        />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Cards, below lg ------------------------------------------- */}
      {visible.length > 0 && (
        <ul className="flex flex-col gap-2 lg:hidden">
          {visible.map((r) => (
            <li
              key={r.id}
              className={cn(
                'relative rounded-(--radius-card) border bg-surface p-3.5 transition-colors',
                selected.has(r.id) ? 'border-brand-600 bg-brand-50/40' : 'border-ink-200',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setOpenId(r.id)}
                  className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-(--radius-card) focus-visible:after:ring-2 focus-visible:after:ring-brand-600"
                >
                  <span className="sr-only">
                    {t('reviewRow', { reference: r.reference, name: r.user.name })}
                  </span>
                  <PersonCell name={r.user.name} secondary={r.reference} size="md" />
                </button>
                <div className="shrink-0 text-right">
                  <p className="text-[0.9375rem] font-bold text-ink-900 tabular-nums">{ghs(r.ghs)}</p>
                  <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                    {r.points.toLocaleString()} pts
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-200 pt-2.5">
                <Destination r={r} />
                <span className="relative z-10 shrink-0">
                  <MoreMenu label={t('menuLabel', { reference: r.reference })} items={menuFor(r)} />
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusDot tone={PAYOUT_TONE[r.status]}>{ts(r.status)}</StatusDot>
                <span className="text-[0.6875rem] text-ink-400">
                  {format.relativeTime(new Date(r.requestedAt), now)}
                </span>
                {canDispute(r, now) && (
                  <span className="text-[0.6875rem] text-violet-700">
                    {t('disputeWindow', { hours: hoursLeft(r) })}
                  </span>
                )}
                {r.risk !== 'low' && (
                  <span className="text-[0.6875rem] font-medium text-warning-600">
                    {t(`riskLevel.${r.risk}`)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Selection bar ---------------------------------------------
          Appears only once something is selected. Approving twenty clean MoMo
          payouts one panel at a time is the laborious case this exists for;
          decline stays single-payout, because a bulk decline is twenty people
          told no without anyone reading why. */}
      {selectedRows.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-(--radius-card) border border-ink-300 bg-ink-900 px-3 py-2.5 shadow-[0_12px_32px_-8px_rgb(15_23_42/0.4)] dark:bg-surface">
            <p className="min-w-0 flex-1 text-[0.75rem] font-medium text-white dark:text-ink-900">
              {t('bulk.selected', {
                count: selectedRows.length,
                total: ghs(selectedRows.reduce((n, r) => n + r.ghs, 0)),
              })}
            </p>
            {(() => {
              const eligible = bulkEligible(selectedRows, 'approve', now)
              return (
                <button
                  type="button"
                  disabled={eligible.length === 0}
                  onClick={() => decideMany(eligible.map((r) => r.id), 'approve')}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-(--radius-input) bg-white px-3 text-[0.75rem] font-semibold text-ink-900 transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-brand-600 dark:text-white"
                >
                  <Check aria-hidden className="size-3.5" />
                  {t('bulk.approve', { count: eligible.length })}
                </button>
              )
            })()}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label={t('bulk.clear')}
              className="grid size-8 shrink-0 place-items-center rounded-(--radius-input) text-white/70 transition-colors hover:bg-white/10 hover:text-white dark:text-ink-500 dark:hover:bg-ink-100 dark:hover:text-ink-900"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      )}

      <PayoutDrawer request={open} now={now} onClose={() => setOpenId(null)} onDecide={decide} />
    </div>
  )
}

function SummaryCell({
  label,
  count,
  value,
  emphasis,
}: {
  label: string
  count: number
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="px-3 py-3 sm:px-4 sm:py-3.5">
      {/* Three across at every width. Stacking these on a phone pushed the
          queue itself below the fold, which is the opposite of what a summary
          is for — it is meant to be glanced at on the way past. */}
      <p className="text-[0.6875rem] leading-snug font-medium text-ink-500">{label}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            'text-[1.25rem] leading-none font-semibold tabular-nums sm:text-[1.375rem]',
            emphasis && count > 0 ? 'text-warning-600' : 'text-ink-900',
          )}
        >
          {count}
        </span>
        <span className="text-[0.6875rem] text-ink-400 tabular-nums sm:text-[0.75rem]">{value}</span>
      </p>
    </div>
  )
}
