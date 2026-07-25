'use client'

import { Archive, Film, ListChecks, Pause, Play } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import type { AdItem } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
import { DetailPanel, Fact, PanelFacts, PanelFooter, PanelSection } from './DetailPanel'

/**
 * One ad, its delivery, and what it is costing the platform.
 *
 * The questions themselves are not editable here yet — that is the ad editor,
 * a form with branching rules and cue points, and it is its own piece of work.
 * What this panel does is the thing an operator needs every day and could not
 * do at all before: see whether an ad is worth keeping live, and pause it.
 *
 * The arithmetic it shows is deliberately the arithmetic nobody does by hand:
 * remaining slots × points = the platform's forward liability on this one ad,
 * and the same figure in cedis. An ad with 140 slots left is finishing; an ad
 * with 11,000 slots left at 120 points each is GHS 1,320 of unbudgeted
 * earning waiting to happen.
 */

const STATUS_TONE = {
  live: 'success',
  paused: 'warning',
  draft: 'neutral',
  archived: 'neutral',
} as const

export function AdPanel({
  ad,
  onClose,
  onStatus,
}: {
  ad: AdItem | null
  onClose: () => void
  onStatus: (id: string, status: AdItem['status']) => void
}) {
  const t = useTranslations('admin.ads')
  const format = useFormatter()

  if (!ad) return null
  const a = ad

  const remaining = Math.max(0, a.budget - a.completions)
  const pct = a.budget === 0 ? 0 : Math.min(100, Math.round((a.completions / a.budget) * 100))
  const liabilityGhs = Math.round((remaining * a.points) / 1000)

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <DetailPanel
      title={t('panel.title', { title: a.title })}
      closeLabel={t('panel.close')}
      onClose={onClose}
      header={
        <div className="flex items-center gap-2.5">
          {a.format === 'survey' ? (
            <ListChecks aria-hidden className="size-3.5 shrink-0 text-violet-600" />
          ) : (
            <Film aria-hidden className="size-3.5 shrink-0 text-brand-600" />
          )}
          <span className="text-[0.75rem] font-medium text-ink-600">
            {t(`format.${a.format}`)}
          </span>
          <StatusDot tone={STATUS_TONE[a.status]}>{t(`status.${a.status}`)}</StatusDot>
        </div>
      }
      footer={
        a.status !== 'archived' && (
          <PanelFooter>
            <div className="flex flex-wrap gap-2">
              {a.status === 'live' ? (
                <Button
                  type="button"
                  size="md"
                  variant="primary"
                  className="flex-1"
                  onClick={() => onStatus(a.id, 'paused')}
                >
                  <Pause aria-hidden className="size-4" />
                  {t('actions.pause')}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="md"
                  variant="primary"
                  className="flex-1"
                  onClick={() => onStatus(a.id, 'live')}
                >
                  <Play aria-hidden className="size-4" />
                  {t('actions.resume')}
                </Button>
              )}
              <Button
                type="button"
                size="md"
                variant="ghost"
                className="text-danger-700 hover:bg-danger-50"
                onClick={() => onStatus(a.id, 'archived')}
              >
                <Archive aria-hidden className="size-4" />
                {t('actions.archive')}
              </Button>
            </div>
          </PanelFooter>
        )
      }
    >
      <h2 className="text-[1.125rem] leading-snug font-semibold tracking-[-0.01em] text-ink-900">
        {a.title}
      </h2>
      <p className="mt-1 text-[0.8125rem] text-ink-500">{a.advertiser}</p>

      <PanelSection label={t('panel.delivery')}>
        <div className="rounded-(--radius-card) border border-ink-200 bg-ink-50/50 p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[1.5rem] leading-none font-semibold text-ink-900 tabular-nums">
              {pct}%
            </span>
            <span className="text-[0.75rem] text-ink-500 tabular-nums">
              {t('delivered', {
                done: a.completions.toLocaleString(),
                budget: a.budget.toLocaleString(),
                pct,
              })}
            </span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-ink-200">
            <div
              className={cn('h-full rounded-full', pct >= 90 ? 'bg-warning-500' : 'bg-brand-600')}
              style={{ width: `${pct}%` }}
            />
          </div>
          {pct >= 90 && a.status === 'live' && (
            <p className="mt-2.5 text-[0.75rem] font-medium text-warning-600">
              {t('panel.nearlyDone', { remaining: remaining.toLocaleString() })}
            </p>
          )}
        </div>
      </PanelSection>

      <PanelSection label={t('panel.cost')}>
        <PanelFacts>
          <Fact label={t('panel.reward')} value={t('ptsEachValue', { points: a.points })} />
          <Fact label={t('panel.remaining')} value={remaining.toLocaleString()} />
          <Fact
            label={t('panel.liability')}
            value={`GHS ${liabilityGhs.toLocaleString()}`}
          />
          <Fact
            label={t('panel.perCompletion')}
            value={`GHS ${(a.points / 1000).toFixed(3)}`}
          />
        </PanelFacts>
        <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-ink-400">
          {t('panel.liabilityNote')}
        </p>
      </PanelSection>

      <PanelSection label={t('panel.setup')}>
        <PanelFacts>
          <Fact
            label={t('panel.length')}
            value={a.format === 'survey' ? t('panel.noVideo') : `${a.durationSeconds}s`}
          />
          <Fact label={t('panel.questions')} value={a.questions.toLocaleString()} />
          <Fact
            label={t('panel.audience')}
            value={a.tiers.length === 0 ? t('everyone') : a.tiers.join(', ')}
          />
          <Fact label={t('panel.created')} value={date(a.createdAt)} />
        </PanelFacts>
      </PanelSection>

      {/* Honest about what is not here. The question editor is a real screen
          with branching rules and cue points, and pretending this panel edits
          them would be worse than saying it does not. */}
      <p className="mt-5 rounded-(--radius-input) border border-dashed border-ink-200 px-3 py-2.5 text-[0.75rem] leading-relaxed text-ink-500">
        {t('panel.editorNote')}
      </p>
    </DetailPanel>
  )
}
