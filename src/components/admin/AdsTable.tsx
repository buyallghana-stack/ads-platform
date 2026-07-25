'use client'

import { useMemo, useState } from 'react'

import { Archive, Copy, Film, ListChecks, PanelRight, Pause, Pencil, Play } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import type { AdItem } from '@/lib/admin/types'
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
import { AdPanel } from './AdPanel'

/**
 * The ad pool — everything users can be served, and what it is costing.
 *
 * WHAT THIS SCREEN IS FOR
 * Not "list the ads". The operator opens it to answer three questions, and
 * the layout is built around them in order:
 *
 *   1. Is anything about to stop serving? Budget delivery is a bar in the
 *      row, not a number to be worked out — 7,860 of 8,000 is a percentage
 *      nobody computes while scanning, so the row computes it.
 *   2. What is each completion costing me? Points per completion times
 *      remaining budget is the platform's forward liability on this ad, and
 *      it is the reason an ad gets paused.
 *   3. Who can see it? Empty tiers means everyone. Anything else is a
 *      deliberate restriction and gets said out loud, because a survey that
 *      quietly serves to 30 Platinum users looks broken otherwise.
 *
 * Videos and surveys share the table rather than splitting into two, because
 * they compete for the same daily cap and the same budget — the operator's
 * decision is "which of these is worth serving", and a tab per format would
 * hide half the answer.
 */

type Filter = 'live' | 'paused' | 'draft' | 'archived' | 'all'

const FILTERS: Filter[] = ['live', 'paused', 'draft', 'archived', 'all']

const STATUS_TONE = {
  live: 'success',
  paused: 'warning',
  draft: 'neutral',
  archived: 'neutral',
} as const

export function AdsTable({ initial, serverNow }: { initial: AdItem[]; serverNow: number }) {
  const t = useTranslations('admin.ads')
  const format = useFormatter()

  const [rows, setRows] = useState(initial)
  const [filter, setFilter] = useState<Filter>('live')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((a) => filter === 'all' || a.status === filter)
      .filter((a) => !q || [a.title, a.advertiser].join(' ').toLowerCase().includes(q))
  }, [rows, filter, query])

  const setStatus = (id: string, status: AdItem['status']) =>
    setRows((all) => all.map((a) => (a.id === id ? { ...a, status } : a)))

  const summary = useMemo(() => {
    const live = rows.filter((a) => a.status === 'live')
    const remaining = live.reduce((n, a) => n + Math.max(0, a.budget - a.completions), 0)
    return {
      live: live.length,
      videos: live.filter((a) => a.format === 'video').length,
      surveys: live.filter((a) => a.format === 'survey').length,
      remaining,
      /* Points still owed if every remaining slot were filled, at the seeded
         1,000 pts = GHS 1. The number that decides whether the pool is
         affordable, and one no row can show on its own. */
      liabilityGhs: Math.round(
        live.reduce((n, a) => n + Math.max(0, a.budget - a.completions) * a.points, 0) / 1000,
      ),
    }
  }, [rows])

  const tabs: Tab<Filter>[] = FILTERS.map((f) => ({
    key: f,
    label: t(`filters.${f}`),
    count: f === 'all' ? rows.length : rows.filter((a) => a.status === f).length,
  }))

  const menuFor = (a: AdItem): MenuItem[] => {
    const items: MenuItem[] = [
      { key: 'open', label: t('actions.review'), icon: <PanelRight />, onSelect: () => setOpenId(a.id) },
      { key: 'edit', label: t('actions.edit'), icon: <Pencil />, separated: true, onSelect: () => setOpenId(a.id) },
      { key: 'duplicate', label: t('actions.duplicate'), icon: <Copy />, onSelect: () => setOpenId(a.id) },
    ]

    if (a.status === 'live') {
      items.push({ key: 'pause', label: t('actions.pause'), icon: <Pause />, separated: true, onSelect: () => setStatus(a.id, 'paused') })
    }
    if (a.status === 'paused' || a.status === 'draft') {
      items.push({ key: 'resume', label: t('actions.resume'), icon: <Play />, separated: true, onSelect: () => setStatus(a.id, 'live') })
    }
    if (a.status !== 'archived') {
      items.push({
        key: 'archive',
        label: t('actions.archive'),
        icon: <Archive />,
        tone: 'danger',
        separated: true,
        /* Archive, never delete. The database only allows an outright delete
           while nobody has attempted the ad; after that the evidence behind
           paid completions has to survive, so the UI does not offer a verb
           it cannot honour. */
        hint: t('actions.archiveHint'),
        onSelect: () => setStatus(a.id, 'archived'),
      })
    }

    return items
  }

  const FormatIcon = ({ format: f }: { format: AdItem['format'] }) =>
    f === 'survey' ? (
      <ListChecks aria-hidden className="size-3.5 shrink-0 text-violet-600" />
    ) : (
      <Film aria-hidden className="size-3.5 shrink-0 text-brand-600" />
    )

  /** Delivery against budget, as a bar plus the numbers under it. */
  const Delivery = ({ a }: { a: AdItem }) => {
    const pct = a.budget === 0 ? 0 : Math.min(100, Math.round((a.completions / a.budget) * 100))
    // Amber from 90%: the point at which somebody should be deciding whether
    // to top the budget up, not the point at which it has already stopped.
    const nearlyDone = pct >= 90
    return (
      <div className="min-w-[7rem]">
        <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
          <div
            className={cn('h-full rounded-full', nearlyDone ? 'bg-warning-500' : 'bg-brand-600')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-[0.6875rem] text-ink-500 tabular-nums">
          {t('delivered', {
            done: a.completions.toLocaleString(),
            budget: a.budget.toLocaleString(),
            pct,
          })}
        </p>
      </div>
    )
  }

  const Audience = ({ a }: { a: AdItem }) =>
    a.tiers.length === 0 ? (
      <span className="text-[0.75rem] text-ink-500">{t('everyone')}</span>
    ) : (
      <span className="flex flex-wrap gap-1">
        {a.tiers.map((tier) => (
          <span
            key={tier}
            className="rounded-full bg-violet-50 px-1.5 py-px text-[0.625rem] font-semibold text-violet-700"
          >
            {tier}
          </span>
        ))}
      </span>
    )

  const open = rows.find((a) => a.id === openId) ?? null

  return (
    <div>
      <SummaryStrip className="mb-5">
        <SummaryCell
          label={t('summary.live')}
          value={summary.live}
          detail={t('summary.liveSplit', { videos: summary.videos, surveys: summary.surveys })}
        />
        <SummaryCell
          label={t('summary.remaining')}
          value={summary.remaining.toLocaleString()}
          detail={t('summary.remainingHint')}
        />
        <SummaryCell
          label={t('summary.liability')}
          value={`GHS ${summary.liabilityGhs.toLocaleString()}`}
          detail={t('summary.liabilityHint')}
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
      />

      {visible.length === 0 && <EmptyState>{t('empty')}</EmptyState>}

      {visible.length > 0 && (
        <TableShell>
          <thead>
            <tr className="border-b border-ink-200">
              <Th>{t('columns.ad')}</Th>
              <Th align="right">{t('columns.reward')}</Th>
              <Th>{t('columns.delivery')}</Th>
              <Th>{t('columns.audience')}</Th>
              <Th>{t('columns.status')}</Th>
              <Th width="w-12" srOnly>
                {t('columns.action')}
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200">
            {visible.map((a) => (
              <tr
                key={a.id}
                className={cn(
                  'relative align-middle transition-colors hover:bg-ink-50/60',
                  openId === a.id && 'bg-ink-50',
                )}
              >
                <td className="px-4 py-3">
                  <RowOpener label={t('reviewRow', { title: a.title })} onClick={() => setOpenId(a.id)}>
                    <span className="flex items-center gap-2">
                      <FormatIcon format={a.format} />
                      <span className="truncate text-[0.8125rem] font-medium text-ink-900">
                        {a.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate pl-[1.375rem] text-[0.6875rem] text-ink-400">
                      {a.advertiser} · {t(`meta.${a.format}`, {
                        seconds: a.durationSeconds,
                        questions: a.questions,
                      })}
                    </span>
                  </RowOpener>
                </td>

                <td className="px-4 py-3 text-right">
                  <p className="text-[0.8125rem] font-semibold text-ink-900 tabular-nums">
                    {a.points}
                  </p>
                  <p className="text-[0.6875rem] text-ink-400">{t('ptsEach')}</p>
                </td>

                <td className="px-4 py-3">
                  <Delivery a={a} />
                </td>

                <td className="px-4 py-3">
                  <Audience a={a} />
                </td>

                <td className="px-4 py-3">
                  <StatusDot tone={STATUS_TONE[a.status]}>{t(`status.${a.status}`)}</StatusDot>
                  <p className="mt-0.5 text-[0.625rem] text-ink-400">
                    {format.relativeTime(new Date(a.createdAt), serverNow)}
                  </p>
                </td>

                <td className="py-3 pr-3 text-right">
                  <span className="relative z-10 inline-flex">
                    <MoreMenu label={t('menuLabel', { title: a.title })} items={menuFor(a)} />
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
          {visible.map((a) => (
            <li
              key={a.id}
              className="relative rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <RowOpener rounded label={t('reviewRow', { title: a.title })} onClick={() => setOpenId(a.id)}>
                  <span className="flex items-center gap-2">
                    <FormatIcon format={a.format} />
                    <span className="text-[0.875rem] font-semibold text-ink-900">{a.title}</span>
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] text-ink-400">{a.advertiser}</span>
                </RowOpener>
                <span className="relative z-10 shrink-0">
                  <MoreMenu label={t('menuLabel', { title: a.title })} items={menuFor(a)} />
                </span>
              </div>

              <div className="mt-3 border-t border-ink-200 pt-2.5">
                <Delivery a={a} />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StatusDot tone={STATUS_TONE[a.status]}>{t(`status.${a.status}`)}</StatusDot>
                <span className="text-[0.6875rem] font-medium text-ink-700 tabular-nums">
                  {t('ptsEachValue', { points: a.points })}
                </span>
                <Audience a={a} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <AdPanel ad={open} onClose={() => setOpenId(null)} onStatus={setStatus} />
    </div>
  )
}
