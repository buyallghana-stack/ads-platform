'use client'

import { useMemo, useState, useTransition } from 'react'

import {
  AlertTriangle,
  Copy,
  X,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  deletePlan,
  savePlan,
  setPlanVisibility,
} from '@/app/[locale]/admin/(super)/subscriptions/actions'
import { Button } from '@/components/ui/Button'
import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import { checkBand, freeAdCap, nextDraftPlanId, slugify } from '@/lib/admin/plan-value'
import type { PlanRow } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
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
import { PlanPanel } from './PlanPanel'

/**
 * Subscriptions — the plans, whether they are selling, and the editor.
 *
 * WHAT THE COLUMNS ARE FOR
 * The last column is the one that justifies the screen: revenue per plan
 * against what that plan costs the platform in extra earning. A Platinum
 * subscriber pays GHS 200 and earns at double with 120 ads a day — the plan
 * is only worth selling while the first number stays ahead of the second, and
 * no other screen puts them side by side.
 *
 * Free is listed with the paid plans on purpose. It is the denominator: 2,423
 * people on Free against 418 paying is the conversion rate, and hiding the
 * free tier would make the paid numbers look like the whole platform. It is
 * also the plan that sets the free allowance every other plan is measured
 * against, so editing it moves the whole ladder.
 *
 * A PRICE IS A FLOOR, NOT A PRICE
 * Since migration 098 a plan is a BAND: Bronze sells from GHS 65 to GHS 139,
 * and what somebody pays inside it decides what an ad is worth to them. So the
 * price column shows the range, and there is a column for what buyers actually
 * chose — the one question flexible pricing exists to raise is whether anybody
 * pays above the floor, and no other screen can answer it.
 *
 * THE WARNING
 * A band is cut against the NEXT plan, so a plan can be broken by an edit to
 * its neighbour. The row flags the three ways that goes wrong — a band nobody
 * can buy in, and a rate or an ad count that falls as the price rises — and
 * the editor names which. It is a warning, not a block: a promotional plan is
 * a legitimate thing to want, and the operator is entitled to overrule a
 * warning they understand.
 */

type Filter = 'all' | 'live' | 'hidden'

const FILTERS: Filter[] = ['all', 'live', 'hidden']

const ghs = (n: number) => `GHS ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

/* The top of a band is one pesewa under the next plan (GHS 139.99), which
   rounds UP to the next plan's own price in whole cedis and reads as though
   the two overlap. Floored, exactly as the upgrade screen floors it. */
const bandTop = (n: number) => Math.floor(n)

export function PlansTable({ initial }: { initial: PlanRow[] }) {
  const t = useTranslations('admin.subscriptions')

  const [rows, setRows] = useState(initial)
  /* What the database said when it refused — shown verbatim, because it
     raises these in operator language ("The starting plan must stay free"). */
  const [error, setError] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  /** The plan being edited, or 'new' while creating one. */
  const [editing, setEditing] = useState<PlanRow | 'new' | null>(null)

  /* The free allowance, which every stacking sum counts once. */
  const free = useMemo(() => freeAdCap(rows), [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((p) => filter === 'all' || p.status === filter)
      .filter((p) => !q || [p.name, p.slug, p.description].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [rows, filter, query])

  const summary = useMemo(() => {
    const paid = rows.filter((p) => p.priceGhs > 0)
    const activePaid = paid.reduce((n, p) => n + p.active, 0)
    const everyone = rows.reduce((n, p) => n + p.active, 0)
    /* Purchases that took the offer up on itself. Across the ladder rather
       than per plan, because "are people paying more than they have to" is a
       question about the pricing MODEL, not about Bronze. */
    const bought = paid.reduce((n, p) => n + p.paidCount, 0)
    const above = paid.reduce((n, p) => n + p.paidAboveFloor, 0)
    return {
      activePaid,
      everyone,
      monthly: paid.reduce((n, p) => n + p.monthlyGhs, 0),
      conversion: everyone === 0 ? 0 : Math.round((activePaid / everyone) * 1000) / 10,
      bought,
      above,
      abovePct: bought === 0 ? 0 : Math.round((above / bought) * 1000) / 10,
    }
  }, [rows])

  /**
   * Real as of 2026-07-29. What comes back is the refreshed list, and that is
   * what gets rendered — never the draft that was submitted. The database
   * refuses things this table cannot know about (a slug rename, making the
   * starting plan cost money), and painting the optimistic version would show
   * an operator a plan that does not exist in that shape.
   */
  const save = (plan: PlanRow) => {
    setError(null)
    startTransition(async () => {
      const result = await savePlan({
        // A draft plan's local id is not a uuid — it means "new".
        id: /^[0-9a-f-]{36}$/i.test(plan.id) ? plan.id : undefined,
        slug: plan.slug,
        name: plan.name,
        description: plan.description,
        priceGhs: plan.priceGhs,
        billingPeriodDays: plan.billingPeriodDays,
        dailyAdCap: plan.dailyAdCap,
        rewardMultiplier: plan.rewardMultiplier,
        redemptionMinimumPoints: plan.redemptionMinimumPoints,
        referralBonusMultiplier: plan.referralBonusMultiplier,
        adPriority: plan.adPriority,
        adCooldownSeconds: plan.adCooldownSeconds,
        sortOrder: plan.sortOrder,
        /* Always sent, null included — `admin_save_plan` reads these two by
           KEY PRESENCE precisely so that null can mean "clear it". Omitting
           them would mean "leave alone", and the top plan could never go back
           to a single price once it had a range. */
        bandMaxGhs: plan.ownBandMaxGhs,
        bandMaxMultiplier: plan.ownBandMaxMultiplier,
      })
      if (result.plans) setRows(result.plans)
      if (!result.ok) return setError(result.message)
      setEditing(null)
    })
  }

  const setStatus = (id: string, status: PlanRow['status']) => {
    setError(null)
    startTransition(async () => {
      const result = await setPlanVisibility(id, status === 'live')
      if (result.plans) setRows(result.plans)
      if (!result.ok) setError(result.message)
    })
  }

  const remove = (p: PlanRow) => {
    setError(null)
    startTransition(async () => {
      const result = await deletePlan(p.id)
      if (result.plans) setRows(result.plans)
      if (!result.ok) return setError(result.message)
      // A plan somebody has bought is hidden rather than deleted, because the
      // statement is built from those payments. Say which happened.
      if (result.outcome === 'hidden') setError(t('hiddenInstead', { name: p.name }))
      setEditing(null)
    })
  }

  const duplicate = (p: PlanRow) => {
    const copy: PlanRow = {
      ...p,
      id: nextDraftPlanId(),
      slug: slugify(`${p.slug}-copy`),
      name: t('copyOf', { name: p.name }),
      // A duplicate is never the default and never inherits the sales figures
      // — they belong to the plan people actually bought.
      isDefault: false,
      status: 'hidden',
      sortOrder: Math.max(...rows.map((r) => r.sortOrder)) + 1,
      active: 0,
      activeLastMonth: 0,
      monthlyGhs: 0,
      paidCount: 0,
      paidAboveFloor: 0,
      paidAvgGhs: null,
      // The band is cut by the database once the copy has a sort order it
      // actually holds. Until then there is nothing honest to show.
      bandMaxGhs: null,
    }
    setRows((all) => [...all, copy])
    setEditing(copy)
  }

  const tabs: Tab<Filter>[] = FILTERS.map((f) => ({
    key: f,
    label: t(`filters.${f}`),
    count: f === 'all' ? rows.length : rows.filter((p) => p.status === f).length,
  }))

  const menuFor = (p: PlanRow): MenuItem[] => {
    const items: MenuItem[] = [
      { key: 'edit', label: t('actions.edit'), icon: <Pencil />, onSelect: () => setEditing(p) },
      {
        key: 'duplicate',
        label: t('actions.duplicate'),
        icon: <Copy />,
        hint: t('actions.duplicateHint'),
        onSelect: () => duplicate(p),
      },
    ]

    /* The default plan cannot be hidden or deleted — the database refuses
       both, because every new user is put on it and auto-downgraded back to
       it on expiry. Absent rather than disabled, as everywhere else here. */
    if (!p.isDefault) {
      items.push({
        key: 'visibility',
        label: p.status === 'live' ? t('actions.hide') : t('actions.show'),
        icon: p.status === 'live' ? <EyeOff /> : <Eye />,
        separated: true,
        hint: p.status === 'live' && p.active > 0 ? t('actions.hideHint', { count: p.active }) : undefined,
        onSelect: () => !busy && setStatus(p.id, p.status === 'live' ? 'hidden' : 'live'),
      })

      /* Delete appears ONLY when it can actually delete. A plan anybody has
         bought is kept — the payments behind the statement point at it — and
         the database turns the attempt into a hide. Offering it anyway, under
         the label of what would really happen, put "Take off sale" in the menu
         twice: two identical labels doing two different things is worse than
         one honest one, and the visibility item above already does it. */
      if (p.active === 0 && p.monthlyGhs === 0) {
        items.push({
          key: 'delete',
          label: t('actions.delete'),
          icon: <Trash2 />,
          tone: 'danger',
          separated: true,
          onSelect: () => !busy && remove(p),
        })
      }
    }

    return items
  }

  /* What is wrong with where this plan sits, if anything — checked against
     the whole ladder, because a plan is broken by its NEIGHBOUR as often as
     by itself. */
  const trouble = (p: PlanRow) => checkBand(p, rows).problems

  /* The band, in the two lines the row has room for. A hidden plan and the
     free plan have no band at all — `bandMaxGhs` is null for both — so they
     show the plain figure rather than a range invented on the client. */
  const Price = ({ p }: { p: PlanRow }) => {
    const top = p.bandMaxGhs === null ? null : bandTop(p.bandMaxGhs)
    if (top === null || top <= p.priceGhs) return <>{ghs(p.priceGhs)}</>
    return (
      <>
        {ghs(p.priceGhs)}
        <span className="text-ink-400"> – </span>
        {top.toLocaleString()}
      </>
    )
  }

  /* What buyers picked inside the band. An em dash rather than "0 of 0": no
     sales is not the same finding as sales that all sat on the floor. */
  const Chosen = ({ p }: { p: PlanRow }) => {
    if (p.priceGhs === 0) return <span className="text-[0.75rem] text-ink-400">—</span>
    if (p.paidCount === 0) return <span className="text-[0.75rem] text-ink-400">—</span>
    return (
      <span className="block">
        <span className="block text-[0.8125rem] font-medium text-ink-900 tabular-nums">
          {p.paidAvgGhs === null ? '—' : ghs(p.paidAvgGhs)}
        </span>
        <span className="block text-[0.6875rem] text-ink-400 tabular-nums">
          {t('chosenAbove', { count: p.paidAboveFloor, of: p.paidCount })}
        </span>
      </span>
    )
  }

  /* Every way a plan's position in the ladder can be wrong, named. The first
     one is the serious one — a band nobody can buy in — so it is the one
     shown when several are true at once. */
  const Trouble = ({ p, card }: { p: PlanRow; card?: boolean }) => {
    const problems = trouble(p)
    if (problems.length === 0) return null
    const worst = problems.includes('unbuyable') ? 'unbuyable' : problems[0]!
    return (
      <p
        className={cn(
          'flex items-center gap-1 font-medium',
          card ? 'mt-2 gap-1.5 text-[0.6875rem]' : 'mt-1 text-[0.625rem]',
          worst === 'unbuyable' ? 'text-danger-600' : 'text-warning-600',
        )}
      >
        <AlertTriangle aria-hidden className="size-3 shrink-0" />
        {t(`bandWarn.${worst}.short`)}
      </p>
    )
  }

  const Benefits = ({ p }: { p: PlanRow }) =>
    p.priceGhs === 0 ? (
      <span className="text-[0.75rem] text-ink-500">{t('benefits.none')}</span>
    ) : (
      <span className="text-[0.75rem] text-ink-600">
        {t('benefits.value', { multiplier: p.rewardMultiplier, ads: p.dailyAdCap })}
      </span>
    )

  const Trend = ({ p }: { p: PlanRow }) => {
    const delta = p.active - p.activeLastMonth
    const pct = p.activeLastMonth === 0 ? 0 : Math.round((delta / p.activeLastMonth) * 1000) / 10
    const up = delta >= 0
    const Arrow = up ? TrendingUp : TrendingDown
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-[0.75rem] font-medium tabular-nums',
          up ? 'text-success-700' : 'text-danger-700',
        )}
      >
        <Arrow aria-hidden className="size-3" />
        {Math.abs(pct)}%
      </span>
    )
  }

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-3.5 py-3"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-700" />
          <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-danger-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded p-0.5 text-danger-700/70 hover:text-danger-700"
          >
            <X aria-hidden className="size-4" />
            <span className="sr-only">{t('dismissError')}</span>
          </button>
        </div>
      )}

      <SummaryStrip cols={4} className="mb-5">
        <SummaryCell
          label={t('summary.paying')}
          value={summary.activePaid.toLocaleString()}
          detail={t('summary.payingHint', { total: summary.everyone.toLocaleString() })}
        />
        <SummaryCell
          label={t('summary.monthly')}
          value={ghs(summary.monthly)}
          detail={t('summary.monthlyHint')}
        />
        <SummaryCell
          label={t('summary.conversion')}
          value={`${summary.conversion}%`}
          detail={t('summary.conversionHint')}
        />
        {/* The verdict on flexible pricing itself. If this stays at 0% then
            the band is decoration and everybody is buying at the floor. */}
        <SummaryCell
          label={t('summary.aboveFloor')}
          value={summary.bought === 0 ? '—' : `${summary.abovePct}%`}
          detail={
            summary.bought === 0
              ? t('summary.aboveFloorNone')
              : t('summary.aboveFloorHint', { above: summary.above, of: summary.bought })
          }
        />
      </SummaryStrip>

      <Toolbar
        tabs={tabs}
        active={filter}
        onSelect={setFilter}
        tabsLabel={t('filterLabel')}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t('searchPlaceholder')}
        actions={
          <Button type="button" size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden className="size-4" />
            {t('actions.new')}
          </Button>
        }
      />

      {visible.length === 0 && <EmptyState>{t('empty')}</EmptyState>}

      {/* ---- Table, lg and up ------------------------------------------- */}
      {visible.length > 0 && (
        <TableShell>
          <thead>
            <tr className="border-b border-ink-200">
              <Th>{t('columns.plan')}</Th>
              <Th>{t('columns.price')}</Th>
              <Th>{t('columns.benefits')}</Th>
              <Th align="right">{t('columns.active')}</Th>
              <Th align="right">{t('columns.chosen')}</Th>
              <Th align="right">{t('columns.change')}</Th>
              <Th align="right">{t('columns.revenue')}</Th>
              <Th width="w-12" srOnly>
                {t('columns.action')}
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200">
            {visible.map((p) => (
              <tr
                key={p.id}
                className={cn(
                  'relative align-middle transition-colors hover:bg-ink-50/60',
                  editing !== 'new' && editing?.id === p.id && 'bg-ink-50',
                )}
              >
                <td className="px-4 py-3">
                  <RowOpener label={t('editRow', { name: p.name })} onClick={() => setEditing(p)}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.8125rem] font-semibold text-ink-900">{p.name}</span>
                      {p.isDefault && (
                        <span className="rounded-full bg-ink-100 px-1.5 py-px text-[0.625rem] font-semibold text-ink-500">
                          {t('defaultBadge')}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block font-mono text-[0.6875rem] text-ink-400">
                      {p.slug}
                    </span>
                  </RowOpener>
                  <StatusDot
                    tone={p.status === 'live' ? 'success' : 'neutral'}
                    className="mt-1 text-[0.625rem]"
                  >
                    {t(`status.${p.status}`)}
                  </StatusDot>
                </td>

                <td className="px-4 py-3">
                  <p className="text-[0.8125rem] font-medium text-ink-900 tabular-nums">
                    {p.priceGhs === 0 ? t('freeLabel') : <Price p={p} />}
                  </p>
                  {p.priceGhs > 0 && (
                    <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                      {t('perDays', { days: p.billingPeriodDays })}
                    </p>
                  )}
                </td>

                <td className="px-4 py-3">
                  <Benefits p={p} />
                  {/* On the row, so it is seen while scanning rather than only
                      once the plan is opened. */}
                  <Trouble p={p} />
                </td>

                <td className="px-4 py-3 text-right text-[0.8125rem] font-medium text-ink-900 tabular-nums">
                  {p.active.toLocaleString()}
                </td>

                <td className="px-4 py-3 text-right">
                  <Chosen p={p} />
                </td>

                <td className="px-4 py-3 text-right">
                  <Trend p={p} />
                </td>

                <td className="px-4 py-3 text-right text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                  {p.monthlyGhs === 0 ? '—' : ghs(p.monthlyGhs)}
                </td>

                <td className="py-3 pr-3 text-right">
                  <span className="relative z-10 inline-flex">
                    <MoreMenu label={t('menuLabel', { name: p.name })} items={menuFor(p)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {/* ---- Cards, below lg ------------------------------------------- */}
      {visible.length > 0 && (
        <ul className="flex flex-col gap-2 lg:hidden">
          {visible.map((p) => (
            <li
              key={p.id}
              className="relative rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <RowOpener
                  rounded
                  label={t('editRow', { name: p.name })}
                  onClick={() => setEditing(p)}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.875rem] font-semibold text-ink-900">{p.name}</span>
                    {p.isDefault && (
                      <span className="rounded-full bg-ink-100 px-1.5 py-px text-[0.625rem] font-semibold text-ink-500">
                        {t('defaultBadge')}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[0.75rem] text-ink-500">
                    <Benefits p={p} />
                  </span>
                </RowOpener>
                <div className="flex shrink-0 items-start gap-1">
                  <p className="text-[0.9375rem] font-semibold text-ink-900 tabular-nums">
                    {p.priceGhs === 0 ? t('freeLabel') : <Price p={p} />}
                  </p>
                  <span className="relative z-10">
                    <MoreMenu label={t('menuLabel', { name: p.name })} items={menuFor(p)} />
                  </span>
                </div>
              </div>

              <Trouble p={p} card />

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-ink-200 pt-2.5">
                <StatusDot tone={p.status === 'live' ? 'success' : 'neutral'}>
                  {t(`status.${p.status}`)}
                </StatusDot>
                <span className="text-[0.75rem] text-ink-500">
                  {t('columns.active')}{' '}
                  <span className="font-semibold text-ink-900 tabular-nums">
                    {p.active.toLocaleString()}
                  </span>
                </span>
                <Trend p={p} />
                {p.paidCount > 0 && p.paidAvgGhs !== null && (
                  <span className="text-[0.75rem] text-ink-500">
                    {t('columns.chosen')}{' '}
                    <span className="font-semibold text-ink-900 tabular-nums">
                      {ghs(p.paidAvgGhs)}
                    </span>
                  </span>
                )}
                {p.monthlyGhs > 0 && (
                  <span className="ml-auto text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                    {ghs(p.monthlyGhs)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <PlanPanel
          plan={editing === 'new' ? null : editing}
          plans={rows}
          free={free}
          onClose={() => setEditing(null)}
          onSave={(plan) => {
            save(plan)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
