'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'

import {
  AlertTriangle,
  ChartNoAxesColumn,
  Check,
  Coins,
  Gift,
  PanelRight,
  Smartphone,
  Users,
  X,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  decideCommissionPayout,
  markCommissionPayoutPaid,
} from '@/app/[locale]/admin/(super)/affiliates/actions'
import { Link } from '@/i18n/navigation'
import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import type { CommissionPayout, CommissionPayoutStatus, CommissionTotals } from '@/lib/admin/data/affiliates'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import {
  EmptyState,
  RowOpener,
  SummaryCell,
  SummaryStrip,
  TableShell,
  Th,
  Toolbar,
  type Tab,
} from './AdminTable'
import { DetailPanel, Fact, PanelFacts, PanelFooter, PanelSection } from './DetailPanel'

/**
 * Commission withdrawals waiting on the operator.
 *
 * ── WHY THIS IS NOT A TAB ON THE POINTS QUEUE ──
 *
 * It looks like the same screen and it is not the same money. Points move
 * through a peg and pay out of `points_ledger`; commission is cedis already
 * and pays out of `commission_ledger`, under its own licence switch, with its
 * own minimum. D27 is that the two never mix, and one table rendering both
 * would need a branch at every column — amount, minimum, ledger, refusal — of
 * which the first one anybody forgets pays the wrong person out of the wrong
 * pot. So: same furniture, same language, separate screen.
 *
 * ── TRIAGE / DECIDE / REPEAT ──
 *
 * The split the operator asked for on 2026-07-25, applied here rather than
 * re-decided. The ROW says who, how much, where to, how old and what state —
 * enough to know whether to look. The PANEL carries the arithmetic (what was
 * asked, the frozen fee, what actually leaves), what the affiliate has left
 * behind this request, and the full-size buttons. The overflow MENU is for
 * the ones an operator has already decided about at a glance.
 *
 * Approve fires from the menu; reject and mark-paid never do. A rejection
 * needs a reason the affiliate is shown, and marking paid is irreversible —
 * both open the panel, because one click from Approve is not worth the
 * keystroke saved on a money screen.
 *
 * ── WHAT COMES BACK IS WHAT THE DATABASE SAYS ──
 *
 * Every action re-renders from the list the server action returns, never from
 * a predicted status. The database refuses things this table cannot know:
 * a request another operator decided thirty seconds ago, marking paid on
 * something never approved, deciding while the licence switch went off. A
 * predicted "paid" that the database still has sitting in the queue is the
 * one bug this screen cannot be allowed to have.
 *
 * DESTINATIONS ARRIVE MASKED from `admin_list_commission_payouts` — this
 * component never holds a whole number, so there is nothing here to reveal.
 */

type Filter = 'queue' | 'approved' | 'paid' | 'rejected' | 'all'

const FILTERS: Filter[] = ['queue', 'approved', 'paid', 'rejected', 'all']

const TONE: Record<CommissionPayoutStatus, 'warning' | 'brand' | 'success' | 'danger' | 'neutral'> =
  {
    requested: 'warning',
    approved: 'brand',
    paid: 'success',
    rejected: 'danger',
    cancelled: 'neutral',
  }

export function CommissionQueue({
  initial,
  totals,
  payoutsEnabled,
  serverNow,
}: {
  initial: CommissionPayout[]
  totals: CommissionTotals
  /** `affiliate_payouts_enabled`. Off, the queue can still be worked — what it
   *  cannot do is receive anything new, and saying so beats an empty screen
   *  that looks like a bug. */
  payoutsEnabled: boolean
  /** The server's clock at render.
   *
   *  ⚠️ NOT OPTIONAL, and not decoration. "3 hours ago" computed from
   *  `Date.now()` on the server and again on the client lands on two different
   *  strings, and React throws a hydration error (#418) over the difference —
   *  which is exactly how this screen shipped its first bug, caught by the
   *  verification's page-error check rather than by looking at it. Seeding
   *  from one clock makes the first client paint identical to the server's. */
  serverNow: number
}) {
  const t = useTranslations('admin.affiliates')
  const format = useFormatter()

  const [rows, setRows] = useState(initial)

  /* Ticks every minute so "7 hours ago" stays honest while the operator is
     looking at the queue, rather than only on reload. */
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const [filter, setFilter] = useState<Filter>('queue')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const counts = useMemo(
    () => ({
      queue: rows.filter((r) => r.status === 'requested').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      paid: rows.filter((r) => r.status === 'paid').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      all: rows.length,
    }),
    [rows],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => (filter === 'queue' ? r.status === 'requested' : filter === 'all' || r.status === filter))
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.affiliateCode.toLowerCase().includes(q) ||
          /* The MASKED destination, which is the only form this component
             holds. Searching the whole number would make the box an oracle
             for "is this wallet in the system". */
          r.destination.toLowerCase().includes(q),
      )
  }, [rows, filter, query])

  const open = rows.find((r) => r.id === openId) ?? null

  const apply = (result: {
    ok: boolean
    message?: string
    payouts?: CommissionPayout[]
  }) => {
    if (result.payouts) setRows(result.payouts)
    setError(result.ok ? null : (result.message ?? null))
    if (result.ok) setOpenId(null)
  }

  const approve = (id: string) =>
    startTransition(async () => {
      apply(await decideCommissionPayout({ id, decision: 'approve' }))
    })

  const reject = (id: string, note: string) =>
    startTransition(async () => {
      apply(await decideCommissionPayout({ id, decision: 'reject', note }))
    })

  const markPaid = (id: string, reference: string) =>
    startTransition(async () => {
      apply(await markCommissionPayoutPaid({ id, reference }))
    })

  const tabs: Tab<Filter>[] = FILTERS.map((key) => ({
    key,
    label: t(`tabs.${key}`),
    count: counts[key],
  }))

  return (
    <>
      <SummaryStrip cols={4} className="mb-4">
        {/* Owed leads and is the only emphasised figure: it is the one that
            represents work waiting, and colouring every number teaches
            nothing. */}
        <SummaryCell
          label={t('summary.owed')}
          value={cedis(totals.owedMinor)}
          detail={t('summary.owedDetail', { n: totals.affiliatesOwed })}
          emphasis={totals.owedMinor > 0}
        />
        <SummaryCell label={t('summary.pending')} value={cedis(totals.pendingMinor)} />
        <SummaryCell label={t('summary.paid')} value={cedis(totals.paidMinor)} />
        <SummaryCell label={t('summary.reversed')} value={cedis(totals.reversedMinor)} />
      </SummaryStrip>

      {!payoutsEnabled && (
        <p className="mb-4 flex items-start gap-2 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 px-4 py-3 text-[0.8125rem] leading-snug text-ink-800">
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-warning-600" />
          {t('closed')}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-(--radius-card) border border-danger-500/30 bg-danger-50 px-4 py-3 text-[0.8125rem] leading-snug text-ink-900"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-600" />
          {error}
        </p>
      )}

      <Toolbar
        tabs={tabs}
        active={filter}
        onSelect={setFilter}
        tabsLabel={t('tabsLabel')}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t('searchPlaceholder')}
        actions={
          <>
            <Link
              href="/admin/affiliates/report"
              className="inline-flex shrink-0 items-center gap-2 rounded-(--radius-input) border border-ink-300 px-3 py-2 text-[0.8125rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
            >
              <ChartNoAxesColumn aria-hidden className="size-4" />
              {t('seeReport')}
            </Link>
            <Link
              href="/admin/affiliates/rewards"
              className="inline-flex shrink-0 items-center gap-2 rounded-(--radius-input) border border-ink-300 px-3 py-2 text-[0.8125rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
            >
              <Gift aria-hidden className="size-4" />
              {t('seeRewards')}
            </Link>
            <Link
              href="/admin/affiliates/people"
              className="inline-flex shrink-0 items-center gap-2 rounded-(--radius-input) border border-ink-300 px-3 py-2 text-[0.8125rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
            >
              <Users aria-hidden className="size-4" />
              {t('seeAffiliates')}
            </Link>
          </>
        }
      />

      {visible.length === 0 ? (
        <EmptyState>{t(`empty.${filter === 'queue' ? 'queue' : 'other'}`)}</EmptyState>
      ) : (
        <>
          {/* ⚠️ TableShell IS the <table> — and it is `lg:block`, so this half
              of the screen does not exist below lg. Nesting a second <table>
              inside it is a hydration error (React #418), and stopping at the
              table alone leaves a phone showing an empty page. Both were
              shipped here for an hour and both were caught by the
              verification, not by looking at the screen. The card list below
              is the other half, exactly as the points queue does it. */}
          <TableShell>
            <thead>
              <tr>
                <Th>{t('col.affiliate')}</Th>
                <Th width="hidden xl:table-cell">{t('col.destination')}</Th>
                <Th align="right">{t('col.net')}</Th>
                <Th width="hidden xl:table-cell">{t('col.asked')}</Th>
                <Th>{t('col.status')}</Th>
                <Th align="right" width="w-12" srOnly>
                  {t('col.actions')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="relative border-t border-ink-200 hover:bg-ink-50">
                  <td className="px-4 py-3">
                    <RowOpener
                      label={t('review', { name: row.name || row.affiliateCode })}
                      onClick={() => setOpenId(row.id)}
                    >
                      <PersonCell name={row.name || row.affiliateCode} secondary={row.affiliateCode} />
                    </RowOpener>
                  </td>
                  <td className="hidden px-4 py-3 xl:table-cell">
                    <Destination row={row} />
                  </td>
                  {/* The NET, because that is what leaves. The gross is in the
                      panel — an operator who sends the amount asked for has
                      sent the fee back out with the money. */}
                  <td className="px-4 py-3 text-right text-[0.875rem] font-semibold tabular-nums text-ink-900">
                    {row.coin && row.coinAmount !== undefined
                      ? `${row.coinAmount} ${row.coin}`
                      : cedis(row.netMinor)}
                  </td>
                  <td className="hidden px-4 py-3 text-[0.75rem] whitespace-nowrap text-ink-500 xl:table-cell">
                    {format.relativeTime(new Date(row.requestedAt), now)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusDot tone={TONE[row.status]}>{t(`status.${row.status}`)}</StatusDot>
                  </td>
                  {/* `relative z-10` or the RowOpener's stretched ::after
                      swallows the menu — the row would open instead. */}
                  <td className="relative z-10 px-4 py-3 text-right">
                    <MoreMenu
                      label={t('actionsFor', { name: row.name || row.affiliateCode })}
                      items={menuFor(row, {
                        t,
                        onOpen: () => setOpenId(row.id),
                        onApprove: () => approve(row.id),
                      })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          {/* Below lg, the same rows as cards. Not a reduced version — every
              figure an operator decides on is here, because deciding on a
              phone is what they actually do. */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {visible.map((row) => (
              <li
                key={row.id}
                className="relative rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <RowOpener
                    rounded
                    label={t('review', { name: row.name || row.affiliateCode })}
                    onClick={() => setOpenId(row.id)}
                  >
                    <PersonCell
                      name={row.name || row.affiliateCode}
                      secondary={row.affiliateCode}
                      size="md"
                    />
                  </RowOpener>
                  <div className="shrink-0 text-right">
                    <p className="text-[0.9375rem] font-bold tabular-nums text-ink-900">
                      {row.coin && row.coinAmount !== undefined
                        ? `${row.coinAmount} ${row.coin}`
                        : cedis(row.netMinor)}
                    </p>
                    <p className="text-[0.6875rem] tabular-nums text-ink-400">
                      {t('card.of', { amount: cedis(row.amountMinor) })}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-200 pt-2.5">
                  <Destination row={row} />
                  <span className="relative z-10 shrink-0">
                    <MoreMenu
                      label={t('actionsFor', { name: row.name || row.affiliateCode })}
                      items={menuFor(row, {
                        t,
                        onOpen: () => setOpenId(row.id),
                        onApprove: () => approve(row.id),
                      })}
                    />
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusDot tone={TONE[row.status]}>{t(`status.${row.status}`)}</StatusDot>
                  <span className="text-[0.6875rem] text-ink-400">
                    {format.relativeTime(new Date(row.requestedAt), now)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <ReviewPanel
          payout={open}
          pending={pending}
          now={now}
          onClose={() => setOpenId(null)}
          onApprove={() => approve(open.id)}
          onReject={(note) => reject(open.id, note)}
          onMarkPaid={(reference) => markPaid(open.id, reference)}
        />
      )}
    </>
  )
}

/** Where the money is going, already masked upstream. */
function Destination({ row }: { row: CommissionPayout }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[0.75rem] text-ink-600">
      {row.method === 'crypto' ? (
        <Coins aria-hidden className="size-3.5 shrink-0 text-ink-400" />
      ) : (
        <Smartphone aria-hidden className="size-3.5 shrink-0 text-ink-400" />
      )}
      <span className="truncate">{row.destination}</span>
    </span>
  )
}

/**
 * What can be done to this row, from the row.
 *
 * An action that cannot succeed is ABSENT, not disabled — the operator's own
 * rule. A paid withdrawal has no menu items at all beyond opening it, because
 * marked paid is the end of the line.
 */
function menuFor(
  row: CommissionPayout,
  {
    t,
    onOpen,
    onApprove,
  }: { t: (k: string) => string; onOpen: () => void; onApprove: () => void },
): MenuItem[] {
  const items: MenuItem[] = [
    { key: 'open', label: t('menu.review'), icon: <PanelRight />, onSelect: onOpen },
  ]

  if (row.status === 'requested') {
    items.push({ key: 'approve', label: t('menu.approve'), icon: <Check />, onSelect: onApprove })
    /* Reject opens the panel rather than firing: it needs a reason, and the
       affiliate is shown it. */
    items.push({
      key: 'reject',
      label: t('menu.reject'),
      icon: <X />,
      tone: 'danger',
      separated: true,
      onSelect: onOpen,
      hint: t('menu.rejectHint'),
    })
  }

  if (row.status === 'approved') {
    items.push({
      key: 'paid',
      label: t('menu.markPaid'),
      icon: <Check />,
      onSelect: onOpen,
      hint: t('menu.markPaidHint'),
    })
  }

  return items
}

/* ------------------------------------------------------------------ */
/* The panel where the decision is actually made                       */
/* ------------------------------------------------------------------ */

function ReviewPanel({
  payout,
  pending,
  now,
  onClose,
  onApprove,
  onReject,
  onMarkPaid,
}: {
  payout: CommissionPayout
  pending: boolean
  /** The same clock the table uses — see the note on `serverNow`. */
  now: number
  onClose: () => void
  onApprove: () => void
  onReject: (note: string) => void
  onMarkPaid: (reference: string) => void
}) {
  const t = useTranslations('admin.affiliates')
  const format = useFormatter()

  const [note, setNote] = useState('')
  const [reference, setReference] = useState('')
  const [rejecting, setRejecting] = useState(false)

  return (
    <DetailPanel title={t('panel.title')} closeLabel={t('panel.close')} onClose={onClose}>
      <PanelSection label={t('panel.who')}>
        <PersonCell name={payout.name || payout.affiliateCode} secondary={payout.affiliateCode} size="md" />
      </PanelSection>

      <PanelSection label={t('panel.money')}>
        <PanelFacts>
          <Fact label={t('panel.asked')} value={cedis(payout.amountMinor)} />
          <Fact label={t('panel.fee')} value={`− ${cedis(payout.feeMinor)}`} />
          {/* What actually leaves. Stated as its own fact rather than left to
              be worked out from the two above it. */}
          <Fact label={t('panel.net')} value={cedis(payout.netMinor)} />
          <Fact label={t('panel.leftAfter')} value={cedis(payout.balanceAfter)} />
          {payout.coin && payout.coinAmount !== undefined && (
            /* Crypto is owed in the COIN, frozen at request time — whoever
               asked for 12 USDT receives 12 USDT whatever the rate does. */
            <Fact label={t('panel.inCoin')} value={`${payout.coinAmount} ${payout.coin}`} />
          )}
          <Fact
            label={t('panel.requested')}
            value={format.relativeTime(new Date(payout.requestedAt), now)}
          />
        </PanelFacts>
      </PanelSection>

      <PanelSection label={t('panel.destination')}>
        <p className="font-mono text-[0.8125rem] text-ink-800">{payout.destination}</p>
        <p className="mt-1 text-[0.75rem] leading-snug text-ink-500">{t('panel.destinationNote')}</p>
      </PanelSection>

      {payout.reviewNotes && (
        <PanelSection label={t('panel.note')}>
          <p className="text-[0.8125rem] leading-relaxed text-ink-800">{payout.reviewNotes}</p>
        </PanelSection>
      )}

      {payout.status === 'requested' && rejecting && (
        <PanelSection label={t('panel.rejectReason')}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t('panel.rejectPlaceholder')}
            className="w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.8125rem] text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25 pointer-coarse:text-base"
          />
          <p className="mt-1 text-[0.75rem] text-ink-500">{t('panel.rejectShown')}</p>
        </PanelSection>
      )}

      {payout.status === 'approved' && (
        <PanelSection label={t('panel.reference')}>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t('panel.referencePlaceholder')}
            className="w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.8125rem] text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25 pointer-coarse:text-base"
          />
          <p className="mt-1 text-[0.75rem] leading-snug text-ink-500">{t('panel.referenceNote')}</p>
        </PanelSection>
      )}

      <PanelFooter>
        {payout.status === 'requested' ? (
          <div className="flex flex-wrap gap-2">
            {rejecting ? (
              <>
                <button
                  type="button"
                  disabled={pending || note.trim().length < 3}
                  onClick={() => onReject(note)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-(--radius-input) px-4 py-2.5 text-[0.875rem] font-semibold',
                    pending || note.trim().length < 3
                      ? 'cursor-not-allowed bg-ink-100 text-ink-400'
                      : 'bg-danger-600 text-white hover:bg-danger-500',
                  )}
                >
                  <X aria-hidden className="size-4" />
                  {t('panel.confirmReject')}
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="rounded-(--radius-input) border border-ink-300 px-4 py-2.5 text-[0.875rem] font-semibold text-ink-700"
                >
                  {t('panel.cancel')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onApprove}
                  className="inline-flex items-center gap-2 rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500 disabled:bg-ink-100 disabled:text-ink-400"
                >
                  <Check aria-hidden className="size-4" />
                  {t('panel.approve')}
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(true)}
                  className="rounded-(--radius-input) border border-ink-300 px-4 py-2.5 text-[0.875rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
                >
                  {t('panel.reject')}
                </button>
              </>
            )}
          </div>
        ) : payout.status === 'approved' ? (
          <button
            type="button"
            disabled={pending || reference.trim().length < 3}
            onClick={() => onMarkPaid(reference)}
            className={cn(
              'inline-flex items-center gap-2 rounded-(--radius-input) px-4 py-2.5 text-[0.875rem] font-semibold',
              pending || reference.trim().length < 3
                ? 'cursor-not-allowed bg-ink-100 text-ink-400'
                : 'bg-success-600 text-white hover:bg-success-500',
            )}
          >
            <Check aria-hidden className="size-4" />
            {t('panel.markPaid')}
          </button>
        ) : (
          /* Paid and rejected are the end of the line — an action bar with
             nothing in it would only invite looking for one. */
          <p className="text-[0.8125rem] text-ink-500">{t(`panel.done.${payout.status}`)}</p>
        )}
      </PanelFooter>
    </DetailPanel>
  )
}
