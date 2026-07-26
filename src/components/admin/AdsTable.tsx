'use client'

import { useMemo, useState, useTransition } from 'react'

import {
  Archive,
  Copy,
  Film,
  GitBranch,
  ListChecks,
  PanelRight,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { setAdStatus } from '@/app/[locale]/admin/ads/actions'
import { Button } from '@/components/ui/Button'
import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import { useRouter } from '@/i18n/navigation'
import type { AdListItem, AdStatus } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { AdPanel } from './AdPanel'
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
 *
 * TRIAGE / DECIDE / REPEAT, the same split as the payout queue: the row says
 * enough to decide whether to look, the panel carries the detail and the
 * buttons, and the ⋯ menu is for the ones already decided at a glance.
 * Pausing is reversible and fires straight from the menu; anything that
 * removes an ad opens the panel, where the consequence is spelled out.
 */

type Filter = 'active' | 'paused' | 'draft' | 'exhausted' | 'archived' | 'all'

const FILTERS: Filter[] = ['active', 'paused', 'draft', 'exhausted', 'archived', 'all']

const STATUS_TONE = {
  active: 'success',
  paused: 'warning',
  draft: 'neutral',
  exhausted: 'brand',
  archived: 'neutral',
} as const

export function AdsTable({
  ads,
  pointsPerGhs,
  serverNow,
}: {
  ads: AdListItem[]
  pointsPerGhs: number
  serverNow: number
}) {
  const t = useTranslations('admin.ads')
  const format = useFormatter()
  const router = useRouter()

  const [, startAction] = useTransition()

  /*
    Optimistic status, reset by comparing the prop DURING RENDER rather than
    in an effect. A pause has to look instant, but the truth is the server's:
    revalidatePath re-renders this screen with the real row, and that is the
    moment the optimistic layer must drop — an effect would run a frame later
    and briefly re-apply a stale value over fresh data.
  */
  const [overrides, setOverrides] = useState<Record<string, AdStatus>>({})
  const [seen, setSeen] = useState(ads)
  if (seen !== ads) {
    setSeen(ads)
    setOverrides({})
  }

  const rows = useMemo(
    () => ads.map((a) => (overrides[a.id] ? { ...a, status: overrides[a.id] } : a)),
    [ads, overrides],
  )

  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<{ id: string; removing: boolean } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((a) => filter === 'all' || a.status === filter)
      .filter((a) => !q || [a.title, a.advertiser ?? ''].join(' ').toLowerCase().includes(q))
  }, [rows, filter, query])

  const changeStatus = (id: string, status: AdStatus) => {
    setFailure(null)
    setOverrides((o) => ({ ...o, [id]: status }))
    startAction(async () => {
      const result = await setAdStatus(id, status)
      if (!result.ok) {
        // Put the row back where it was and say why, rather than leaving a
        // green dot on an ad the database refused to publish.
        setOverrides((o) => {
          const next = { ...o }
          delete next[id]
          return next
        })
        setFailure(result.message)
        return
      }
      router.refresh()
    })
  }

  const summary = useMemo(() => {
    const live = rows.filter((a) => a.status === 'active')
    const remaining = live.reduce(
      (n, a) => n + (a.budget === null ? 0 : Math.max(0, a.budget - a.completions)),
      0,
    )
    return {
      live: live.length,
      videos: live.filter((a) => a.format === 'video').length,
      surveys: live.filter((a) => a.format === 'survey').length,
      remaining,
      unlimited: live.some((a) => a.budget === null),
      /* Points still owed if every remaining slot were filled, at the current
         rate. The number that decides whether the pool is affordable, and one
         no row can show on its own. */
      liabilityGhs: Math.round(
        live.reduce(
          (n, a) =>
            n + (a.budget === null ? 0 : Math.max(0, a.budget - a.completions) * a.points),
          0,
        ) / pointsPerGhs,
      ),
    }
  }, [rows, pointsPerGhs])

  const tabs: Tab<Filter>[] = FILTERS.map((f) => ({
    key: f,
    label: t(`filters.${f}`),
    count: f === 'all' ? rows.length : rows.filter((a) => a.status === f).length,
  }))

  const menuFor = (a: AdListItem): MenuItem[] => {
    const items: MenuItem[] = [
      {
        key: 'open',
        label: t('actions.review'),
        icon: <PanelRight />,
        onSelect: () => setOpen({ id: a.id, removing: false }),
      },
      {
        key: 'edit',
        label: t('actions.edit'),
        icon: <Pencil />,
        separated: true,
        onSelect: () => router.push(`/admin/ads/${a.id}`),
      },
      {
        key: 'duplicate',
        label: t('actions.duplicate'),
        icon: <Copy />,
        hint: t('actions.duplicateHint'),
        onSelect: () => router.push(`/admin/ads/new?from=${a.id}`),
      },
    ]

    if (a.status === 'active') {
      items.push({
        key: 'pause',
        label: t('actions.pause'),
        icon: <Pause />,
        separated: true,
        onSelect: () => changeStatus(a.id, 'paused'),
      })
    }
    if (a.status === 'paused' || a.status === 'draft') {
      items.push({
        key: 'resume',
        label: t('actions.resume'),
        icon: <Play />,
        separated: true,
        onSelect: () => changeStatus(a.id, 'active'),
      })
    }

    if (a.status !== 'archived') {
      // One verb, never both, and never a disabled one: the database deletes
      // outright only while nobody has attempted the ad, because after that
      // the attempts are the evidence behind completions people were paid for.
      const deletable = a.attempts === 0 && a.completions === 0
      items.push({
        key: 'remove',
        label: deletable ? t('actions.delete') : t('actions.archive'),
        icon: deletable ? <Trash2 /> : <Archive />,
        tone: 'danger',
        separated: true,
        hint: deletable ? t('actions.deleteHint') : t('actions.archiveHint'),
        /* Opens the panel rather than firing. Removing an ad one click away
           from "Duplicate" is not a keystroke worth saving. */
        onSelect: () => setOpen({ id: a.id, removing: true }),
      })
    }

    return items
  }

  const FormatIcon = ({ format: f }: { format: AdListItem['format'] }) =>
    f === 'survey' ? (
      <ListChecks aria-hidden className="size-3.5 shrink-0 text-violet-600" />
    ) : (
      <Film aria-hidden className="size-3.5 shrink-0 text-brand-600" />
    )

  /** Delivery against budget, as a bar plus the numbers under it. */
  const Delivery = ({ a }: { a: AdListItem }) => {
    if (a.budget === null) {
      return (
        <p className="text-[0.6875rem] text-ink-500 tabular-nums">
          {t('deliveredUnlimited', { done: a.completions.toLocaleString() })}
        </p>
      )
    }
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

  const Audience = ({ a }: { a: AdListItem }) =>
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

  /**
   * What the ad is made of, in the terms the player uses.
   *
   * The advertiser is a member of this line rather than a prefix glued on
   * with a separator: a trailing "·" left dangling at a line break is the
   * kind of small wrongness that makes a table look unfinished.
   */
  const Shape = ({ a, advertiser }: { a: AdListItem; advertiser?: boolean }) => (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.6875rem] text-ink-400">
      {advertiser && a.advertiser && <span>{a.advertiser} ·</span>}
      <span>
        {a.format === 'video'
          ? t('meta.video', { seconds: a.durationSeconds ?? 0, questions: a.questionCount })
          : t('meta.survey', { questions: a.questionCount })}
      </span>
      {a.branchingCount > 0 && (
        <span className="inline-flex items-center gap-0.5 font-medium text-violet-700">
          <GitBranch aria-hidden className="size-3" />
          {t('branching')}
        </span>
      )}
      {a.format === 'video' && a.cueCount > 0 && (
        <span className="font-medium text-ink-500">{t('cues', { count: a.cueCount })}</span>
      )}
    </span>
  )

  const opened = open ? (rows.find((a) => a.id === open.id) ?? null) : null

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
          detail={summary.unlimited ? t('summary.remainingUnlimited') : t('summary.remainingHint')}
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
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => router.push('/admin/ads/new?format=survey')}
            >
              <ListChecks aria-hidden className="size-4" />
              {t('newSurvey')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => router.push('/admin/ads/new?format=video')}
            >
              <Plus aria-hidden className="size-4" />
              {t('newVideo')}
            </Button>
          </div>
        }
      />

      {failure && (
        <p
          role="alert"
          className="mb-3 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] font-medium text-danger-700"
        >
          {failure}
        </p>
      )}

      {visible.length === 0 && (
        <EmptyState>{rows.length === 0 ? t('emptyPool') : t('empty')}</EmptyState>
      )}

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
                  open?.id === a.id && 'bg-ink-50',
                )}
              >
                <td className="px-4 py-3">
                  <RowOpener
                    label={t('reviewRow', { title: a.title })}
                    onClick={() => setOpen({ id: a.id, removing: false })}
                  >
                    <span className="flex items-center gap-2">
                      <FormatIcon format={a.format} />
                      <span className="truncate text-[0.8125rem] font-medium text-ink-900">
                        {a.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block pl-[1.375rem]">
                      <Shape a={a} advertiser />
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
                <RowOpener
                  rounded
                  label={t('reviewRow', { title: a.title })}
                  onClick={() => setOpen({ id: a.id, removing: false })}
                >
                  <span className="flex items-center gap-2">
                    <FormatIcon format={a.format} />
                    <span className="text-[0.875rem] font-semibold text-ink-900">{a.title}</span>
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] text-ink-400">
                    {a.advertiser ?? t('noAdvertiser')}
                  </span>
                  <span className="mt-0.5 block">
                    <Shape a={a} />
                  </span>
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

      {opened && (
        <AdPanel
          key={opened.id}
          ad={opened}
          pointsPerGhs={pointsPerGhs}
          startRemoving={open?.removing ?? false}
          onClose={() => setOpen(null)}
          onStatus={changeStatus}
          onRemoved={() => {
            setOpen(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
