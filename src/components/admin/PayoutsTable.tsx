'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'

import { AlertTriangle, Check, Clock, Coins, PanelRight, Smartphone, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { approvePayouts, decidePayout } from '@/app/[locale]/admin/payouts/actions'
import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import { maskDestination } from '@/lib/admin/destination'
import { needsEarlyApproval, type PayoutRequest, type PayoutStatus } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import {
  EmptyState,
  RowCheckbox,
  RowOpener,
  SelectionAction,
  SelectionBar,
  SummaryCell,
  SummaryStrip,
  TableShell,
  Th,
  Toolbar,
  type Tab,
} from './AdminTable'
import { PayoutDrawer } from './PayoutDrawer'
import {
  ACTION_RULES,
  availableActions,
  bulkEligible,
  effectiveRule,
  type PayoutAction,
} from './payout-actions'
import { PAYOUT_TONE } from './payout-status'
import { payoutHeadline } from './payout-amount'

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
 * The furniture (summary strip, tabs, table shell, selection bar) now lives
 * in AdminTable so the rest of the admin area inherits it rather than
 * re-deciding it. This screen stays the reference implementation.
 *
 * DESTINATIONS ARE MASKED. Every account number and wallet address in this
 * table is masked by `maskDestination`, and there is deliberately no way to
 * unmask one from the row — the reveal lives in the panel, one payout at a
 * time, and re-masks itself. A queue of thirty full phone numbers is a
 * screenshot waiting to happen.
 *
 * NO ACTIONS ON A PAID PAYOUT. Disputes were removed on 2026-07-29 — the
 * operator holds a request before the money leaves instead, which tells the
 * user why and can be undone. Marked paid is now the end of the line.
 *
 * DECISIONS ARE REAL AS OF 2026-07-28. `decide` calls the server action,
 * which calls `admin_decide_redemption`, which calls the pipeline function
 * that owns the transition. What comes back is the refreshed queue, and that
 * is what gets rendered — NOT `ACTION_RULES[action].next`.
 *
 * That distinction matters here more than it looks. The database refuses
 * things this table cannot know about: approving inside a holding period
 * without the audited override, marking paid while the licence flag is off,
 * deciding a request another operator decided thirty seconds ago. Painting
 * the predicted status and quietly keeping it would show an operator a payout
 * marked completed that the database still has sitting in the queue.
 */

type Filter = 'queue' | 'all' | PayoutStatus

/* Only the states that actually occur get a tab. `cancelled` and `failed`
   exist in the type because the database has them, but a tab that is always
   empty is a tab that teaches the operator to ignore the tab row. */
const FILTERS: Filter[] = ['queue', 'approved', 'paid', 'rejected', 'all']

const ACTION_ICON: Record<PayoutAction, React.ReactNode> = {
  approve: <Check />,
  hold: <Clock />,
  decline: <X />,
  markPaid: <Check />,
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

  /* Ticks every minute so relative times ("7 hours ago") stay honest while
     the operator is looking at the queue, rather than only on reload. */
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const [filter, setFilter] = useState<Filter>('queue')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)

  /* What the database said when it refused. Shown verbatim — the pipeline
     raises these in operator language ("Payouts are disabled", "Only an
     approved redemption can be marked paid"), and rewording them here would
     mean maintaining a second vocabulary for the same rules. */
  const [error, setError] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  const inQueue = (r: PayoutRequest) => r.status === 'pending_approval' || r.status === 'held'

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) =>
        filter === 'queue' ? inQueue(r) : filter === 'all' ? true : r.status === filter,
      )
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

  /**
   * One decision, through the server.
   *
   * No optimistic paint. On a screen where the units are other people's
   * money, a row that says "completed" for the half-second before the server
   * disagrees is a row an operator can screenshot, act on, or walk away from.
   * The button reports itself as busy instead, and the row changes when the
   * database says it changed.
   */
  const decide = (id: string, action: PayoutAction, reason: string, reference?: string) => {
    setError(null)

    /* Approving a request that is still held is an OVERRIDE, and the database
       will not do it without being told so explicitly. The flag is derived
       here from the row we already hold rather than threaded through every
       caller's signature — the drawer has already demanded the reason, and
       that reason is what gets recorded against the override. */
    const row = rows.find((r) => r.id === id)
    const early = action === 'approve' && row ? needsEarlyApproval(row) : false

    startTransition(async () => {
      const result = await decidePayout({
        id,
        action,
        reason,
        reference,
        early,
        earlyReason: early ? reason : undefined,
      })

      // A refused decision still returns the queue as it now stands, so a
      // request somebody else has already handled corrects itself on screen
      // instead of staying stale under the error.
      if (result.requests) setRows(result.requests)
      if (!result.ok) {
        setError(result.message)
        return
      }

      setSelected((s) => {
        if (!s.has(id)) return s
        const copy = new Set(s)
        copy.delete(id)
        return copy
      })
      setOpenId(null)
    })
  }

  const decideMany = (ids: string[]) => {
    setError(null)
    startTransition(async () => {
      const result = await approvePayouts(ids)
      if (result.requests) setRows(result.requests)
      if (!result.ok) setError(result.message)
      setSelected(new Set())
    })
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
  const selectable = visible.filter((r) => availableActions(r).length > 0)
  const selectedRows = rows.filter((r) => selected.has(r.id))
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id))

  const toggle = (id: string) =>
    setSelected((s) => {
      const copy = new Set(s)
      if (copy.has(id)) copy.delete(id)
      else copy.add(id)
      return copy
    })

  /** The row's menu: review first, then the decisions, destructive last. */
  const menuFor = (r: PayoutRequest): MenuItem[] => {
    const acts = availableActions(r)
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
        /* effectiveRule, not ACTION_RULES: on a held request Approve needs a
           reason, so it must open the panel rather than firing from the menu
           into a refusal. */
        const rule = effectiveRule(a, r)
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
          onSelect: () => {
            // A decision already in flight makes every menu item inert.
            // Approving the same payout twice is not a duplicate the database
            // silently absorbs — the second call raises, and the operator gets
            // an error for something that worked.
            if (busy) return
            if (rule.confirm || rule.reason) setOpenId(r.id)
            else decide(r.id, a, '')
          },
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

  const tabs: Tab<Filter>[] = FILTERS.map((f) => ({
    key: f,
    label: f === 'queue' ? t('filters.queue') : f === 'all' ? t('filters.all') : ts(f),
    count:
      f === 'queue'
        ? rows.filter(inQueue).length
        : f === 'all'
          ? rows.length
          : rows.filter((r) => r.status === f).length,
  }))

  const open = rows.find((r) => r.id === openId) ?? null

  return (
    <div>
      <SummaryStrip className="mb-5">
        <SummaryCell
          label={t('summary.waiting')}
          value={summary.waiting.count}
          detail={ghs(summary.waiting.ghs)}
          emphasis={summary.waiting.count > 0}
        />
        <SummaryCell
          label={t('summary.approved')}
          value={summary.approved.count}
          detail={ghs(summary.approved.ghs)}
        />
        <SummaryCell
          label={t('summary.paidToday')}
          value={summary.paidToday.count}
          detail={ghs(summary.paidToday.ghs)}
        />
      </SummaryStrip>

      <Toolbar
        tabs={tabs}
        active={filter}
        onSelect={(f) => {
          setFilter(f)
          setSelected(new Set())
        }}
        tabsLabel={t('filterLabel')}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t('searchPlaceholder')}
      />

      {/* A refusal sits above the queue rather than inside the panel that
          caused it: the panel closes on a successful decision, and half the
          refusals arrive from the overflow menu where no panel was ever
          open. `role="alert"` so it is announced — an operator who has just
          pressed Approve and had nothing happen needs telling why. */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-(--radius-card) border border-danger-500/30 bg-danger-50 px-3.5 py-3"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-700" />
          <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-danger-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-[0.75rem] font-medium text-danger-700 underline underline-offset-2"
          >
            {t('errors.dismiss')}
          </button>
        </div>
      )}

      {visible.length === 0 && (
        <EmptyState>{filter === 'queue' ? t('emptyQueue') : t('empty')}</EmptyState>
      )}

      {/* ---- Table, lg and up ------------------------------------------ */}
      {visible.length > 0 && (
        <TableShell>
          <thead>
            <tr className="border-b border-ink-200">
              <Th width="w-10">
                <RowCheckbox
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))
                  }
                  label={t('selectAll')}
                />
              </Th>
              <Th>{t('columns.user')}</Th>
              <Th align="right">{t('columns.amount')}</Th>
              <Th>{t('columns.destination')}</Th>
              <Th>{t('columns.status')}</Th>
              <Th>{t('columns.requested')}</Th>
              <Th width="w-12" srOnly>
                {t('columns.action')}
              </Th>
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
                    <RowCheckbox
                      checked={isSelected}
                      disabled={availableActions(r).length === 0}
                      onChange={() => toggle(r.id)}
                      label={t('selectRow', { reference: r.reference })}
                    />
                  </td>

                  <td className="px-4 py-3">
                    <RowOpener
                      label={t('reviewRow', { reference: r.reference, name: r.user.name })}
                      onClick={() => setOpenId(r.id)}
                    >
                      <PersonCell name={r.user.name} avatarUrl={r.user.avatarUrl} />
                    </RowOpener>
                    <p className="mt-1 pl-[2.625rem] font-mono text-[0.6875rem] text-ink-400">
                      {r.reference}
                    </p>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <p className="text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                      {payoutHeadline(r, format).primary}
                    </p>
                    <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                      {/* Cedis stay in view under a coin figure: it is what
                          the row contributes to the totals above. */}
                      {r.method === 'crypto'
                        ? ghs(r.ghs)
                        : `${r.points.toLocaleString()} pts`}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    <Destination r={r} />
                  </td>

                  <td className="px-4 py-3">
                    <StatusDot tone={PAYOUT_TONE[r.status]}>{ts(r.status)}</StatusDot>
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
        </TableShell>
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
                <RowOpener
                  rounded
                  label={t('reviewRow', { reference: r.reference, name: r.user.name })}
                  onClick={() => setOpenId(r.id)}
                >
                  <PersonCell name={r.user.name} secondary={r.reference} size="md" />
                </RowOpener>
                <div className="shrink-0 text-right">
                  <p className="text-[0.9375rem] font-bold text-ink-900 tabular-nums">
                    {payoutHeadline(r, format).primary}
                  </p>
                  <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                    {r.method === 'crypto' ? ghs(r.ghs) : `${r.points.toLocaleString()} pts`}
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

      {/* Approving twenty clean MoMo payouts one panel at a time is the
          laborious case this exists for. Decline stays single-payout: a bulk
          decline is twenty people told no without anyone reading why. */}
      {selectedRows.length > 0 && (
        <SelectionBar
          summary={t('bulk.selected', {
            count: selectedRows.length,
            total: ghs(selectedRows.reduce((n, r) => n + r.ghs, 0)),
          })}
          onClear={() => setSelected(new Set())}
          clearLabel={t('bulk.clear')}
        >
          {(() => {
            const eligible = bulkEligible(selectedRows, 'approve')
            return (
              <SelectionAction
                disabled={eligible.length === 0 || busy}
                onClick={() => decideMany(eligible.map((r) => r.id))}
              >
                <Check aria-hidden className="size-3.5" />
                {t('bulk.approve', { count: eligible.length })}
              </SelectionAction>
            )
          })()}
        </SelectionBar>
      )}

      <PayoutDrawer
        request={open}
        now={now}
        busy={busy}
        onClose={() => setOpenId(null)}
        onDecide={decide}
      />
    </div>
  )
}
