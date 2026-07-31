'use client'

import { useEffect, useState, useTransition } from 'react'

import {
  Archive,
  Check,
  Film,
  GitBranch,
  Link2,
  ListChecks,
  Loader2,
  Pause,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { deleteAd, loadAdDraft } from '@/app/[locale]/admin/ads/actions'
import { Button } from '@/components/ui/Button'
import { useRouter } from '@/i18n/navigation'
import { isGraded } from '@/lib/admin/ad-draft'
import type { AdDraft, AdListItem, AdStatus } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
import { DetailPanel, Fact, PanelFacts, PanelFooter, PanelSection } from './DetailPanel'

/**
 * One ad: what it is, what it is delivering, and what it is costing.
 *
 * DECIDE, in the payout queue's language. The row was triage; this is where
 * the evidence and the buttons live. The arithmetic it shows is deliberately
 * the arithmetic nobody does by hand — remaining slots × points is the
 * platform's forward liability on this one ad, and it is the reason an ad
 * gets paused. An ad with 140 slots left is finishing; one with 11,000 slots
 * left at 120 points each is GHS 1,320 of earning waiting to happen.
 *
 * The questions are fetched when the panel opens rather than shipped with
 * every row: the list carries counts, which is what scanning needs, and the
 * full text with its answer key is a privileged read that only matters for
 * the one ad being looked at. They are shown READ-ONLY here — editing them
 * is the editor's job, a screen with room for branching rules and cue points.
 */

const STATUS_TONE = {
  active: 'success',
  paused: 'warning',
  draft: 'neutral',
  exhausted: 'brand',
  archived: 'neutral',
} as const

export function AdPanel({
  ad,
  pointsPerGhs,
  startRemoving,
  onClose,
  onStatus,
  onRemoved,
}: {
  ad: AdListItem
  pointsPerGhs: number
  /** Opened straight from the menu's Delete/Archive item. */
  startRemoving: boolean
  onClose: () => void
  onStatus: (id: string, status: AdStatus) => void
  onRemoved: () => void
}) {
  const t = useTranslations('admin.ads')
  const format = useFormatter()
  const router = useRouter()

  const [detail, setDetail] = useState<AdDraft | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [confirming, setConfirming] = useState(startRemoving)
  const [failure, setFailure] = useState<string | null>(null)
  const [working, startWork] = useTransition()

  useEffect(() => {
    let live = true
    loadAdDraft(ad.id)
      .then((draft) => {
        if (!live) return
        if (draft) setDetail(draft)
        else setLoadFailed(true)
      })
      .catch(() => live && setLoadFailed(true))
    return () => {
      live = false
    }
  }, [ad.id])

  const remaining = ad.budget === null ? null : Math.max(0, ad.budget - ad.completions)
  const pct =
    ad.budget === null || ad.budget === 0
      ? null
      : Math.min(100, Math.round((ad.completions / ad.budget) * 100))
  const liabilityGhs =
    remaining === null ? null : Math.round((remaining * ad.points) / pointsPerGhs)

  const deletable = ad.attempts === 0 && ad.completions === 0

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' })

  const remove = () =>
    startWork(async () => {
      const result = await deleteAd(ad.id)
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      onRemoved()
    })

  return (
    <DetailPanel
      title={t('panel.title', { title: ad.title })}
      closeLabel={t('panel.close')}
      onClose={onClose}
      width="lg"
      header={
        <div className="flex items-center gap-2.5">
          {ad.format === 'survey' ? (
            <ListChecks aria-hidden className="size-3.5 shrink-0 text-violet-600" />
          ) : ad.format === 'link' ? (
            <Link2 aria-hidden className="size-3.5 shrink-0 text-teal-700" />
          ) : (
            <Film aria-hidden className="size-3.5 shrink-0 text-brand-600" />
          )}
          <span className="text-[0.75rem] font-medium text-ink-600">{t(`format.${ad.format}`)}</span>
          <StatusDot tone={STATUS_TONE[ad.status]}>{t(`status.${ad.status}`)}</StatusDot>
        </div>
      }
      footer={
        <PanelFooter>
          {failure && (
            <p role="alert" className="mb-2 text-[0.75rem] font-medium text-danger-600">
              {failure}
            </p>
          )}

          {confirming ? (
            <div className="rounded-(--radius-card) border border-danger-500/30 bg-danger-50 p-3">
              <p className="text-[0.8125rem] font-semibold text-danger-700">
                {deletable ? t('panel.confirmDelete') : t('panel.confirmArchive')}
              </p>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-danger-700/90">
                {deletable ? t('panel.confirmDeleteBody') : t('panel.confirmArchiveBody')}
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button type="button" size="sm" variant="danger" loading={working} onClick={remove}>
                  {deletable ? t('actions.delete') : t('actions.archive')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirming(false)}
                >
                  {t('panel.keep')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="md"
                className="flex-1"
                onClick={() => router.push(`/admin/ads/${ad.id}`)}
              >
                <Pencil aria-hidden className="size-4" />
                {t('actions.edit')}
              </Button>

              {ad.status === 'active' && (
                <Button
                  type="button"
                  size="md"
                  variant="secondary"
                  onClick={() => onStatus(ad.id, 'paused')}
                >
                  <Pause aria-hidden className="size-4" />
                  {t('actions.pause')}
                </Button>
              )}
              {(ad.status === 'paused' || ad.status === 'draft') && (
                <Button
                  type="button"
                  size="md"
                  variant="secondary"
                  onClick={() => onStatus(ad.id, 'active')}
                >
                  <Play aria-hidden className="size-4" />
                  {t('actions.resume')}
                </Button>
              )}

              {ad.status !== 'archived' && (
                <Button
                  type="button"
                  size="md"
                  variant="ghost"
                  className="text-danger-700 hover:bg-danger-50"
                  onClick={() => setConfirming(true)}
                >
                  {deletable ? (
                    <Trash2 aria-hidden className="size-4" />
                  ) : (
                    <Archive aria-hidden className="size-4" />
                  )}
                  {deletable ? t('actions.delete') : t('actions.archive')}
                </Button>
              )}
            </div>
          )}
        </PanelFooter>
      }
    >
      <h2 className="text-[1.125rem] leading-snug font-semibold tracking-[-0.01em] text-ink-900">
        {ad.title}
      </h2>
      <p className="mt-1 text-[0.8125rem] text-ink-500">{ad.advertiser ?? t('noAdvertiser')}</p>
      {ad.description && (
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-600">{ad.description}</p>
      )}

      <PanelSection label={t('panel.delivery')}>
        <div className="rounded-(--radius-card) border border-ink-200 bg-ink-50/50 p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[1.5rem] leading-none font-semibold text-ink-900 tabular-nums">
              {pct === null ? ad.completions.toLocaleString() : `${pct}%`}
            </span>
            <span className="text-[0.75rem] text-ink-500 tabular-nums">
              {ad.budget === null
                ? t('deliveredUnlimited', { done: ad.completions.toLocaleString() })
                : t('delivered', {
                    done: ad.completions.toLocaleString(),
                    budget: ad.budget.toLocaleString(),
                    pct: pct ?? 0,
                  })}
            </span>
          </div>
          {pct !== null && (
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-ink-200">
              <div
                className={cn('h-full rounded-full', pct >= 90 ? 'bg-warning-500' : 'bg-brand-600')}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {pct !== null && pct >= 90 && ad.status === 'active' && (
            <p className="mt-2.5 text-[0.75rem] font-medium text-warning-600">
              {t('panel.nearlyDone', { remaining: (remaining ?? 0).toLocaleString() })}
            </p>
          )}
        </div>
      </PanelSection>

      <PanelSection label={t('panel.cost')}>
        <PanelFacts>
          <Fact label={t('panel.reward')} value={t('ptsEachValue', { points: ad.points })} />
          <Fact
            label={t('panel.remaining')}
            value={remaining === null ? t('unlimited') : remaining.toLocaleString()}
          />
          <Fact
            label={t('panel.liability')}
            value={liabilityGhs === null ? t('unlimited') : `GHS ${liabilityGhs.toLocaleString()}`}
          />
          <Fact
            label={t('panel.perCompletion')}
            value={`GHS ${(ad.points / pointsPerGhs).toFixed(3)}`}
          />
        </PanelFacts>
        <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-ink-400">
          {t('panel.liabilityNote', { rate: pointsPerGhs.toLocaleString() })}
        </p>
      </PanelSection>

      <PanelSection label={t('panel.setup')}>
        <PanelFacts>
          {/* A link ad has no film and no questionnaire, so the two facts that
              describe one are replaced by the two that describe it: how long
              the article must be open, and where the link goes. Showing "—"
              four times would be a panel describing what the ad is not. */}
          {ad.format === 'link' ? (
            <>
              <Fact
                label={t('panel.dwell')}
                value={`${ad.minWatchSeconds ?? 0}s`}
              />
              <Fact
                label={t('panel.article')}
                value={
                  detail ? t('panel.articleWords', { count: countWords(detail.articleBody) }) : '…'
                }
              />
            </>
          ) : (
            <>
              <Fact
                label={t('panel.length')}
                value={
                  ad.format === 'survey'
                    ? t('panel.noVideo')
                    : `${ad.durationSeconds ?? 0}s · ${t(`source.${ad.videoSource ?? 'upload'}`)}`
                }
              />
              <Fact
                label={t('panel.minWatch')}
                value={
                  ad.format === 'survey'
                    ? '—'
                    : ad.minWatchSeconds === null
                      ? t('panel.wholeVideo')
                      : `${ad.minWatchSeconds}s`
                }
              />
              <Fact
                label={t('panel.questions')}
                value={t('panel.questionsValue', {
                  total: ad.questionCount,
                  graded: ad.gradedCount,
                })}
              />
              <Fact
                label={t('panel.branching')}
                value={ad.branchingCount > 0 ? t('panel.branchingOn', { count: ad.branchingCount }) : t('panel.branchingOff')}
              />
            </>
          )}
          <Fact
            label={t('panel.audience')}
            value={ad.tiers.length === 0 ? t('everyone') : ad.tiers.join(', ')}
          />
          <Fact label={t('panel.weight')} value={ad.weight} />
          <Fact
            label={t('panel.schedule')}
            value={
              ad.startsAt || ad.endsAt
                ? `${ad.startsAt ? date(ad.startsAt) : '—'} → ${ad.endsAt ? date(ad.endsAt) : '—'}`
                : t('panel.always')
            }
          />
          <Fact label={t('panel.created')} value={date(ad.createdAt)} />
        </PanelFacts>
      </PanelSection>

      {/* ---- What a link ad actually says, and where it sends people ----
          The two things worth reading back before publishing one: an article
          nobody proof-read and a destination with a typo in it are both
          invisible in a table row. */}
      {ad.format === 'link' && (
        <PanelSection label={t('panel.articleList')}>
          {!detail && !loadFailed && (
            <p className="flex items-center gap-2 text-[0.75rem] text-ink-400">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              {t('panel.loading')}
            </p>
          )}
          {loadFailed && <p className="text-[0.75rem] text-ink-400">{t('panel.loadFailed')}</p>}
          {detail && (
            <>
              <p className="max-h-64 overflow-y-auto rounded-(--radius-card) border border-ink-200 bg-canvas p-3 text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-ink-700">
                {detail.articleBody}
              </p>
              {detail.ctaLinks.map((link, index) => (
                <p
                  key={index}
                  className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-ink-600"
                >
                  <Link2 aria-hidden className="size-3.5 shrink-0 text-teal-700" />
                  <span className="truncate">{link.value}</span>
                </p>
              ))}
            </>
          )}
        </PanelSection>
      )}

      {/* ---- The questions themselves ---------------------------------- */}
      {ad.format !== 'link' && (
      <PanelSection label={t('panel.questionList')}>
        {!detail && !loadFailed && (
          <p className="flex items-center gap-2 text-[0.75rem] text-ink-400">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            {t('panel.loading')}
          </p>
        )}
        {loadFailed && (
          <p className="text-[0.75rem] text-ink-400">{t('panel.loadFailed')}</p>
        )}
        {detail && detail.questions.length === 0 && (
          <p className="rounded-(--radius-input) border border-dashed border-ink-200 px-3 py-2.5 text-[0.75rem] leading-relaxed text-ink-500">
            {t('panel.watchOnly')}
          </p>
        )}
        {detail && detail.questions.length > 0 && (
          <ol className="flex flex-col gap-2.5">
            {detail.questions.map((question, index) => {
              const graded = isGraded(question)
              const gate = question.rules
                .map((rule) => {
                  const on = detail.questions.findIndex((q) => q.key === rule.dependsOn)
                  const subject = detail.questions[on]
                  const answer =
                    subject?.format === 'short_text'
                      ? (rule.valueText ?? '')
                      : (subject?.options.find((o) => o.key === rule.optionKey)?.text ?? '')
                  return t(rule.negate ? 'panel.ruleIsNot' : 'panel.ruleIs', {
                    n: on + 1,
                    answer,
                  })
                })
                .join(t(question.conditionMode === 'any' ? 'panel.orJoin' : 'panel.andJoin'))

              return (
                <li
                  key={question.key}
                  className="rounded-(--radius-card) border border-ink-200 bg-canvas p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[0.6875rem] font-semibold text-ink-400">
                      {t('panel.questionN', { n: index + 1 })}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-px text-[0.625rem] font-semibold',
                        graded ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-500',
                      )}
                    >
                      {graded ? t('panel.graded') : t('panel.opinion')}
                    </span>
                    {question.showAtSeconds !== null && (
                      <span className="rounded-full bg-ink-100 px-1.5 py-px text-[0.625rem] font-semibold text-ink-600 tabular-nums">
                        {t('panel.atSecond', { seconds: question.showAtSeconds })}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-[0.8125rem] leading-snug font-medium text-ink-900">
                    {question.text}
                  </p>

                  {gate && (
                    <p className="mt-1 inline-flex items-start gap-1 text-[0.6875rem] leading-snug font-medium text-violet-700">
                      <GitBranch aria-hidden className="mt-px size-3 shrink-0" />
                      {t('panel.shownWhen', { rule: gate })}
                    </p>
                  )}

                  {question.format === 'multiple_choice' ? (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {question.options.map((option) => (
                        <li
                          key={option.key}
                          className={cn(
                            'flex items-center gap-1.5 text-[0.75rem]',
                            option.correct ? 'font-medium text-success-700' : 'text-ink-500',
                          )}
                        >
                          {option.correct ? (
                            <Check aria-hidden className="size-3 shrink-0" />
                          ) : (
                            <span aria-hidden className="size-1 shrink-0 rounded-full bg-ink-300" />
                          )}
                          {option.text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[0.75rem] text-ink-500">
                      {question.correctAnswer
                        ? t('panel.accepts', { answer: question.correctAnswer })
                        : t('panel.freeText')}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </PanelSection>
      )}
    </DetailPanel>
  )
}

/** Rough enough for a fact line: is this article 60 words or 600. */
function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}
