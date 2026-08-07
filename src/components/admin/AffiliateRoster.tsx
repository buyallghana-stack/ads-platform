'use client'

import { useMemo, useState, useTransition } from 'react'

import { AlertTriangle, Ban, PanelRight, RotateCcw, Wallet } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { setAffiliateStatus } from '@/app/[locale]/admin/(super)/affiliates/actions'
import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import type { AffiliateRow } from '@/lib/admin/data/affiliates'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import { EmptyState, RowOpener, TableShell, Th, Toolbar, type Tab } from './AdminTable'
import { DetailPanel, Fact, PanelFacts, PanelFooter, PanelSection } from './DetailPanel'

/**
 * Who is selling, what they have earned, and whether they may go on.
 *
 * ── SUSPENDING DOES NOT TAKE THE MONEY ──
 *
 * The one thing worth saying twice, because the screen has to make it obvious:
 * suspension stops somebody selling and stops them withdrawing. It does not
 * touch the ledger. Money already earned is owed whatever the operator thinks
 * of the account, and a control that could erase a balance by accident is a
 * worse risk than an account holding a balance it cannot move. The panel says
 * so above the button.
 *
 * ── THE FIGURES RECONCILE ON SCREEN ──
 *
 *     gross − reversed − paid out  =  balance + pending
 *
 * Laid out in that order rather than as five unrelated numbers, so an operator
 * can check it by eye. The affiliate's own Earnings screen shows the same
 * identity; if the two ever disagree it is a real bug rather than a rounding
 * difference nobody can localise.
 */

type Filter = 'active' | 'pending' | 'suspended' | 'all'

const FILTERS: Filter[] = ['active', 'pending', 'suspended', 'all']

const TONE: Record<AffiliateRow['status'], 'success' | 'warning' | 'danger'> = {
  active: 'success',
  pending: 'warning',
  suspended: 'danger',
}

export function AffiliateRoster({ initial }: { initial: AffiliateRow[] }) {
  const t = useTranslations('admin.affiliates')
  const format = useFormatter()

  const [rows, setRows] = useState(initial)
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.status === 'active').length,
      pending: rows.filter((r) => r.status === 'pending').length,
      suspended: rows.filter((r) => r.status === 'suspended').length,
      all: rows.length,
    }),
    [rows],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => filter === 'all' || r.status === filter)
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q),
      )
  }, [rows, filter, query])

  const open = rows.find((r) => r.affiliateId === openId) ?? null

  const setStatus = (affiliateId: string, status: 'active' | 'suspended', reason?: string) =>
    startTransition(async () => {
      const result = await setAffiliateStatus({ affiliateId, status, reason })
      if (result.affiliates) setRows(result.affiliates)
      setError(result.ok ? null : (result.message ?? null))
      if (result.ok) setOpenId(null)
    })

  const tabs: Tab<Filter>[] = FILTERS.map((key) => ({
    key,
    label: t(`people.tabs.${key}`),
    count: counts[key],
  }))

  return (
    <>
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
        tabsLabel={t('people.tabsLabel')}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t('people.searchPlaceholder')}
      />

      {visible.length === 0 ? (
        <EmptyState>{t('people.empty')}</EmptyState>
      ) : (
        <>
          {/* TableShell IS the <table> and only exists from lg. See the note
              in CommissionQueue — nesting a table here is a hydration error,
              and the card list below is not optional furniture, it is the
              whole screen on a phone. */}
          <TableShell>
            <thead>
              <tr>
                <Th>{t('people.col.person')}</Th>
                <Th width="hidden xl:table-cell">{t('people.col.upline')}</Th>
                <Th align="right">{t('people.col.sales')}</Th>
                <Th align="right">{t('people.col.balance')}</Th>
                <Th>{t('people.col.status')}</Th>
                <Th align="right" width="w-12" srOnly>
                  {t('col.actions')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.affiliateId}
                  className="relative border-t border-ink-200 hover:bg-ink-50"
                >
                  <td className="px-4 py-3">
                    <RowOpener
                      label={t('people.review', { name: row.name || row.code })}
                      onClick={() => setOpenId(row.affiliateId)}
                    >
                      <PersonCell name={row.name || row.code} secondary={row.code} />
                    </RowOpener>
                  </td>
                  <td className="hidden px-4 py-3 text-[0.8125rem] text-ink-600 xl:table-cell">
                    {row.uplineName ?? <span className="text-ink-400">{t('people.noUpline')}</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-[0.8125rem] tabular-nums text-ink-700">
                    {row.conversions}
                  </td>
                  <td className="px-4 py-3 text-right text-[0.875rem] font-semibold tabular-nums text-ink-900">
                    {cedis(row.balanceMinor)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusDot tone={TONE[row.status]}>{t(`people.status.${row.status}`)}</StatusDot>
                  </td>
                  <td className="relative z-10 px-4 py-3 text-right">
                    <MoreMenu
                      label={t('people.actionsFor', { name: row.name || row.code })}
                      items={menuFor(row, {
                        t,
                        onOpen: () => setOpenId(row.affiliateId),
                        onReinstate: () => setStatus(row.affiliateId, 'active'),
                      })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          {/* The same people as cards below lg. */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {visible.map((row) => (
              <li
                key={row.affiliateId}
                className="relative rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <RowOpener
                    rounded
                    label={t('people.review', { name: row.name || row.code })}
                    onClick={() => setOpenId(row.affiliateId)}
                  >
                    <PersonCell name={row.name || row.code} secondary={row.code} size="md" />
                  </RowOpener>
                  <div className="shrink-0 text-right">
                    <p className="text-[0.9375rem] font-bold tabular-nums text-ink-900">
                      {cedis(row.balanceMinor)}
                    </p>
                    <p className="text-[0.6875rem] tabular-nums text-ink-400">
                      {t('people.card.sales', { n: row.conversions })}
                    </p>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-ink-200 pt-2.5">
                  <StatusDot tone={TONE[row.status]}>{t(`people.status.${row.status}`)}</StatusDot>
                  <span className="relative z-10 shrink-0">
                    <MoreMenu
                      label={t('people.actionsFor', { name: row.name || row.code })}
                      items={menuFor(row, {
                        t,
                        onOpen: () => setOpenId(row.affiliateId),
                        onReinstate: () => setStatus(row.affiliateId, 'active'),
                      })}
                    />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <AffiliatePanel
          affiliate={open}
          pending={pending}
          format={format}
          onClose={() => setOpenId(null)}
          onSuspend={(reason) => setStatus(open.affiliateId, 'suspended', reason)}
          onReinstate={() => setStatus(open.affiliateId, 'active')}
        />
      )}
    </>
  )
}

/**
 * What can be done to an affiliate, from the row or the card.
 *
 * Suspending opens the panel rather than firing: it needs a reason recorded
 * against the account, and the panel is where that is typed. Reinstating fires
 * — it takes a restriction away and needs nothing said about it.
 */
function menuFor(
  row: AffiliateRow,
  {
    t,
    onOpen,
    onReinstate,
  }: { t: (k: string) => string; onOpen: () => void; onReinstate: () => void },
): MenuItem[] {
  return [
    { key: 'open', label: t('menu.review'), icon: <PanelRight />, onSelect: onOpen },
    row.status === 'suspended'
      ? {
          key: 'reinstate',
          label: t('people.menu.reinstate'),
          icon: <RotateCcw />,
          onSelect: onReinstate,
        }
      : {
          key: 'suspend',
          label: t('people.menu.suspend'),
          icon: <Ban />,
          tone: 'danger' as const,
          separated: true,
          hint: t('people.menu.suspendHint'),
          onSelect: onOpen,
        },
  ]
}

function AffiliatePanel({
  affiliate,
  pending,
  format,
  onClose,
  onSuspend,
  onReinstate,
}: {
  affiliate: AffiliateRow
  pending: boolean
  format: ReturnType<typeof useFormatter>
  onClose: () => void
  onSuspend: (reason: string) => void
  onReinstate: () => void
}) {
  const t = useTranslations('admin.affiliates')
  const [reason, setReason] = useState('')
  const [suspending, setSuspending] = useState(false)

  return (
    <DetailPanel title={t('people.panel.title')} closeLabel={t('panel.close')} onClose={onClose}>
      <PanelSection label={t('panel.who')}>
        <PersonCell
          name={affiliate.name || affiliate.code}
          secondary={affiliate.email}
          size="md"
        />
      </PanelSection>

      <PanelSection label={t('people.panel.programme')}>
        <PanelFacts>
          <Fact label={t('people.panel.code')} value={affiliate.code} />
          <Fact
            label={t('people.panel.levels')}
            value={t('people.panel.levelsValue', { n: affiliate.depthNow })}
          />
          <Fact
            label={t('people.panel.tier')}
            value={affiliate.tier ?? t('people.panel.noTier')}
          />
          <Fact
            label={t('people.panel.expires')}
            value={
              affiliate.promotionEnds
                ? format.dateTime(new Date(affiliate.promotionEnds), { dateStyle: 'medium' })
                : '—'
            }
          />
          <Fact label={t('people.panel.recruits')} value={String(affiliate.recruits)} />
          <Fact label={t('people.panel.upline')} value={affiliate.uplineName ?? '—'} />
        </PanelFacts>
      </PanelSection>

      {/* gross − reversed − paid = balance + pending, in that order. */}
      <PanelSection label={t('people.panel.money')}>
        <PanelFacts>
          <Fact label={t('people.panel.gross')} value={cedis(affiliate.grossMinor)} />
          <Fact label={t('people.panel.reversed')} value={`− ${cedis(affiliate.reversedMinor)}`} />
          <Fact label={t('people.panel.paidOut')} value={`− ${cedis(affiliate.paidOutMinor)}`} />
          <Fact label={t('people.panel.balance')} value={cedis(affiliate.balanceMinor)} />
          <Fact label={t('people.panel.pending')} value={cedis(affiliate.pendingMinor)} />
          <Fact label={t('people.panel.clicks')} value={String(affiliate.clicks)} />
        </PanelFacts>
      </PanelSection>

      {suspending && (
        <PanelSection label={t('people.panel.suspendReason')}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t('people.panel.suspendPlaceholder')}
            className="w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.8125rem] text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25 pointer-coarse:text-base"
          />
          {/* The sentence that stops a suspension being mistaken for a
              confiscation. */}
          <p className="mt-1.5 flex items-start gap-1.5 text-[0.75rem] leading-snug text-ink-500">
            <Wallet aria-hidden className="mt-px size-3.5 shrink-0" />
            {t('people.panel.suspendKeepsMoney', { amount: cedis(affiliate.balanceMinor) })}
          </p>
        </PanelSection>
      )}

      <PanelFooter>
        {affiliate.status === 'suspended' ? (
          <button
            type="button"
            disabled={pending}
            onClick={onReinstate}
            className="inline-flex items-center gap-2 rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500 disabled:bg-ink-100 disabled:text-ink-400"
          >
            <RotateCcw aria-hidden className="size-4" />
            {t('people.panel.reinstate')}
          </button>
        ) : suspending ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length < 3}
              onClick={() => onSuspend(reason)}
              className={cn(
                'inline-flex items-center gap-2 rounded-(--radius-input) px-4 py-2.5 text-[0.875rem] font-semibold',
                pending || reason.trim().length < 3
                  ? 'cursor-not-allowed bg-ink-100 text-ink-400'
                  : 'bg-danger-600 text-white hover:bg-danger-500',
              )}
            >
              <Ban aria-hidden className="size-4" />
              {t('people.panel.confirmSuspend')}
            </button>
            <button
              type="button"
              onClick={() => setSuspending(false)}
              className="rounded-(--radius-input) border border-ink-300 px-4 py-2.5 text-[0.875rem] font-semibold text-ink-700"
            >
              {t('panel.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSuspending(true)}
            className="rounded-(--radius-input) border border-ink-300 px-4 py-2.5 text-[0.875rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
          >
            {t('people.panel.suspend')}
          </button>
        )}
      </PanelFooter>
    </DetailPanel>
  )
}
