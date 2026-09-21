'use client'

import { useEffect, useState, useTransition } from 'react'

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Film,
  Link2,
  ListChecks,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { deleteAd, saveAd } from '@/app/[locale]/admin/ads/actions'
import { Link, useRouter } from '@/i18n/navigation'
import {
  ARTICLE_MAX,
  ARTICLE_MIN,
  hasBranching,
  validateAd,
  type AdErrors,
} from '@/lib/admin/ad-draft'
import { CHOOSABLE_STATUSES, type AdDraft, type AdStatus, type TierOption } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { AdCallToAction } from './AdCallToAction'
import { AdMedia, UploadField } from './AdMedia'
import { AdQuestions } from './AdQuestions'
import { StatusDot } from './AdminChrome'
import {
  ChoiceChip,
  Field,
  FieldSet,
  FormSection,
  inputClass,
  Segmented,
  SwitchRow,
} from './FormBits'

/**
 * The ad editor: one ad, everything about it, on one screen.
 *
 * A PAGE, NOT A PANEL. Every other admin record opens in the side panel, and
 * this one deliberately does not. A panel is for deciding about a record you
 * can see whole; an ad is authored — media, budget, targeting, a question
 * list with branching rules inside it — and 27rem of drawer would turn a
 * five-question survey into a scroll tunnel. The list keeps the panel for
 * reviewing; authoring gets the room.
 *
 * WHAT IS FIXED ONCE AN AD EXISTS, AND WHY
 *   format      the database updates every column except this one, because a
 *               survey and a video are different shapes (`ads_video_shape`)
 *               and flipping one into the other would strand its media.
 *   questions   frozen once anybody has completed the ad. Rewriting the
 *               questions under people who already answered rewrites what the
 *               advertiser's research says and orphans the attempts that are
 *               the fraud evidence behind paid completions.
 *
 * Both are shown as facts with reasons, not as fields that mysteriously do
 * nothing.
 *
 * TIMES ARE UTC, and said so. Ghana keeps GMT all year, so for this audience
 * UTC is local time — and rendering a local-timezone string would produce a
 * different value on the server and the client, which is the hydration bug
 * this repo has already paid for once.
 */

export function AdEditor({
  initial,
  tiers,
  pointsPerGhs,
}: {
  initial: AdDraft
  tiers: TierOption[]
  pointsPerGhs: number
}) {
  const t = useTranslations('admin.ads.editor')
  const router = useRouter()

  const [draft, setDraft] = useState<AdDraft>(initial)
  const [showErrors, setShowErrors] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, startSave] = useTransition()
  const [dirty, setDirty] = useState(false)

  const isNew = draft.id === null
  const errors: AdErrors = validateAd(draft)
  const err = (field: string) => {
    const key = showErrors ? errors[field] : undefined
    return key ? t(`errors.${key}`) : undefined
  }

  const set = (patch: Partial<AdDraft>) => {
    setDirty(true)
    setDraft((d) => ({ ...d, ...patch }))
  }

  /* Losing a half-written survey to a stray back gesture is the one mistake
     this screen can make that costs real work. The browser's own prompt is
     enough; a custom modal here would only be prettier. */
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const submit = () => {
    setMessage(null)
    if (Object.keys(errors).length > 0) {
      setShowErrors(true)
      return
    }

    startSave(async () => {
      const result = await saveAd(draft)
      if (result.ok) {
        setDirty(false)
        router.push('/admin/ads')
        router.refresh()
        return
      }
      if ('errors' in result) {
        setShowErrors(true)
        setMessage(t('saveRejected'))
        return
      }
      setMessage(result.message)
    })
  }

  const destroy = () => {
    startSave(async () => {
      const result = await deleteAd(draft.id!)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setDirty(false)
      router.push('/admin/ads')
      router.refresh()
    })
  }

  const budget = draft.maxCompletions
  const liability = budget === null ? null : Math.round((budget * draft.points) / pointsPerGhs)
  /** Never attempted means the database will really delete it; after that the
   *  only honest verb is archive, so only one of the two is ever offered. */
  const deletable = draft.attempts === 0 && draft.completions === 0

  return (
    <div className="pb-0 sm:pb-24">
      {/* ---- Header ----------------------------------------------------- */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <Link
            href="/admin/ads"
            className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {t('backToPool')}
          </Link>
          <h1 className="mt-1.5 text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.5rem]">
            {isNew ? t(`new.${draft.format}`) : draft.title || t('untitled')}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-ink-600">
              {draft.format === 'survey' ? (
                <ListChecks aria-hidden className="size-3.5 text-violet-600" />
              ) : draft.format === 'link' ? (
                <Link2 aria-hidden className="size-3.5 text-teal-700" />
              ) : (
                <Film aria-hidden className="size-3.5 text-brand-600" />
              )}
              {t(`format.${draft.format}`)}
            </span>
            {!isNew && (
              <StatusDot tone={draft.status === 'active' ? 'success' : 'neutral'}>
                {t(`status.${draft.status}`)}
              </StatusDot>
            )}
            {!isNew && (
              <span className="text-[0.75rem] text-ink-400 tabular-nums">
                {t('completedCount', { count: draft.completions })}
              </span>
            )}
          </div>
        </div>

        {/* Hidden on a phone: the same pair lives in the sticky bar at the
            bottom, because saving after filling in five questions should not
            mean scrolling back to the top of the form to find the button. */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <Button type="button" variant="secondary" size="md" onClick={() => router.push('/admin/ads')}>
            {t('cancel')}
          </Button>
          <Button type="button" size="md" loading={saving} onClick={submit}>
            <Check aria-hidden className="size-4" />
            {isNew ? t('create') : t('save')}
          </Button>
        </div>
      </div>

      {message && (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-3.5 py-3 text-[0.8125rem] font-medium text-danger-700"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0" />
          {message}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {/* ---- Basics ------------------------------------------------- */}
          <FormSection title={t('basics')} description={t('basicsHint')}>
            <div className="flex flex-col gap-3">
              <Field label={t('title')} error={err('title')}>
                <input
                  value={draft.title}
                  maxLength={200}
                  placeholder={t('titlePlaceholder')}
                  onChange={(e) => set({ title: e.target.value })}
                  className={inputClass(Boolean(err('title')))}
                />
              </Field>

              <Field label={t('advertiser')} hint={t('advertiserHint')}>
                <input
                  value={draft.advertiser}
                  maxLength={120}
                  placeholder={t('advertiserPlaceholder')}
                  onChange={(e) => set({ advertiser: e.target.value })}
                  className={inputClass(false)}
                />
              </Field>

              {/*
                Directly under the name, because it labels the same thing.
                Leaving it empty is a real answer: the card draws the first
                letter of the name on the same gradient tile it always has,
                which is what every ad looked like before today.

                The file is squared and shrunk to 96px in the browser before
                it is sent. See UploadField.
              */}
              <UploadField
                label={t('advertiserLogo')}
                hint={t('advertiserLogoHint')}
                accept="image/jpeg,image/png,image/webp"
                path={draft.advertiserLogoPath}
                folder="logo"
                image
                squarePx={96}
                onUploaded={(advertiserLogoPath) => set({ advertiserLogoPath })}
                onClear={() => set({ advertiserLogoPath: null })}
              />

              <Field label={t('description')} hint={t('descriptionHint')}>
                <textarea
                  rows={2}
                  value={draft.description}
                  maxLength={400}
                  placeholder={t('descriptionPlaceholder')}
                  onChange={(e) => set({ description: e.target.value })}
                  className={inputClass(false, 'h-auto resize-none py-2')}
                />
              </Field>
            </div>
          </FormSection>

          {/* ---- Video -------------------------------------------------- */}
          {draft.format === 'video' && (
            <FormSection title={t('video')} description={t('videoHint')}>
              <AdMedia draft={draft} error={err('media')} onChange={set} />

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field
                  label={t('duration')}
                  suffix={t('units.seconds')}
                  hint={t('durationHint')}
                  error={err('duration')}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={draft.durationSeconds ?? ''}
                    onChange={(e) =>
                      set({ durationSeconds: e.target.value === '' ? null : Number(e.target.value) })
                    }
                    className={inputClass(Boolean(err('duration')), 'tabular-nums')}
                  />
                </Field>

                <Field
                  label={t('minWatch')}
                  suffix={t('units.seconds')}
                  hint={t('minWatchHint')}
                  error={err('minWatch')}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={draft.minWatchSeconds ?? ''}
                    placeholder={t('minWatchPlaceholder')}
                    onChange={(e) =>
                      set({
                        minWatchSeconds: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className={inputClass(Boolean(err('minWatch')), 'tabular-nums')}
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {/* ---- The article -------------------------------------------- */}
          {draft.format === 'link' && (
            <FormSection title={t('article')} description={t('articleHint')}>
              <Field label={t('articleBody')} error={err('article')}>
                <textarea
                  rows={14}
                  value={draft.articleBody}
                  maxLength={ARTICLE_MAX}
                  placeholder={t('articlePlaceholder')}
                  onChange={(e) => set({ articleBody: e.target.value })}
                  className={inputClass(Boolean(err('article')), 'h-auto resize-y py-2 leading-relaxed')}
                />
              </Field>
              {/* Counted against the number the database will judge it by,
                  and it counts UP to the minimum first — "40 characters
                  needed" is useful, "7,960 remaining" is not, on a field
                  nobody will fill. */}
              <p className="mt-1.5 text-[0.6875rem] text-ink-400 tabular-nums">
                {draft.articleBody.trim().length < ARTICLE_MIN
                  ? t('articleShortOf', {
                      count: ARTICLE_MIN - draft.articleBody.trim().length,
                    })
                  : t('articleCount', {
                      count: draft.articleBody.trim().length,
                      max: ARTICLE_MAX,
                    })}
              </p>

              <div className="mt-3 max-w-xs">
                <Field
                  label={t('dwell')}
                  suffix={t('units.seconds')}
                  hint={t('dwellHint')}
                  error={err('minWatch')}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min={3}
                    value={draft.minWatchSeconds ?? ''}
                    onChange={(e) =>
                      set({
                        minWatchSeconds: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className={inputClass(Boolean(err('minWatch')), 'tabular-nums')}
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {/* ---- Questions ---------------------------------------------- */}
          {/* Not on a link ad: there is no film to have watched and no
              questionnaire to answer, and an answer would have no bearing on
              whether the link was clicked. The database refuses one with a
              trigger, so the form does not offer what the save would reject. */}
          {draft.format !== 'link' && (
            <FormSection
              title={t('questions')}
              description={
                draft.format === 'survey'
                  ? t('questionsHintSurvey')
                  : t('questionsHintVideo')
              }
            >
              <AdQuestions draft={draft} errors={showErrors ? errors : {}} onChange={(questions) => set({ questions })} />
            </FormSection>
          )}

          {/* ---- Call to action ------------------------------------------ */}
          {/* Never on a survey. That is research: sending the respondent to
              the advertiser's shop mid-questionnaire changes what the answers
              mean, and the database refuses it outright. On a link ad this is
              not an extra beside the ad — it IS the ad, and there may be
              exactly one of them. */}
          {draft.format !== 'survey' && (
            <FormSection
              title={draft.format === 'link' ? t('destination') : t('cta')}
              description={draft.format === 'link' ? t('destinationHint') : t('ctaHint')}
            >
              <AdCallToAction
                label={draft.ctaLabel}
                links={draft.ctaLinks}
                errors={errors}
                showErrors={showErrors}
                max={draft.format === 'link' ? 1 : 6}
                onLabel={(ctaLabel) => set({ ctaLabel })}
                onLinks={(ctaLinks) => set({ ctaLinks })}
              />
            </FormSection>
          )}

          {/* ---- Bucket ---------------------------------------------------
              Operator, 2026-08-12: *"remove the audience since every ad has a
              bucket now, so automatically it shows to the audience with the
              plan that ad is being sent on."*

              Right, and the multi-select had stopped making sense: since
              targeting became exclusive an ad belongs to ONE bucket, and a
              chip row inviting three at once described a rule the feed no
              longer follows. So this is one choice, not several, and it says
              BUCKET because that is the word on the board the ad was added
              from.

              It is not removed outright, because an ad that arrives here any
              other way — duplicated, or made with the toolbar's New ad — needs
              somewhere to land, and an ad in the wrong bucket needs moving. */}
          <FormSection title={t('bucket')} description={t('bucketHint')}>
            <div className="flex flex-wrap gap-2">
              <ChoiceChip selected={draft.tierIds.length === 0} onClick={() => set({ tierIds: [] })}>
                {t('everyone')}
              </ChoiceChip>
              {tiers.map((tier) => (
                <ChoiceChip
                  key={tier.id}
                  selected={draft.tierIds[0] === tier.id}
                  /* One bucket, so choosing replaces rather than adds. */
                  onClick={() => set({ tierIds: [tier.id] })}
                >
                  {tier.name}
                </ChoiceChip>
              ))}
            </div>
            <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-ink-400">
              {draft.tierIds.length === 0
                ? t('bucketEveryone')
                : t('bucketOne', {
                    plan: tiers.find((x) => x.id === draft.tierIds[0])?.name ?? '',
                  })}
            </p>
          </FormSection>
        </div>

        {/* ---- Rail ---------------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-4">
          <FormSection title={t('publishing')}>
            <div className="flex flex-col gap-3">
              {/* Draft / Live / Paused are the operator's three. `exhausted`
                  is the database's own verdict and `archived` is a decision
                  taken elsewhere, so neither is offered as a fourth segment —
                  each explains itself and offers the one move back. */}
              {draft.status === 'exhausted' || draft.status === 'archived' ? (
                <div
                  className={cn(
                    'rounded-(--radius-card) border px-3.5 py-3',
                    draft.status === 'exhausted'
                      ? 'border-warning-500/30 bg-warning-50'
                      : 'border-ink-200 bg-ink-50',
                  )}
                >
                  <p
                    className={cn(
                      'text-[0.8125rem] font-semibold',
                      draft.status === 'exhausted' ? 'text-warning-600' : 'text-ink-700',
                    )}
                  >
                    {t(`status.${draft.status}`)}
                  </p>
                  <p
                    className={cn(
                      'mt-1 text-[0.75rem] leading-relaxed',
                      draft.status === 'exhausted' ? 'text-warning-600/90' : 'text-ink-500',
                    )}
                  >
                    {draft.status === 'exhausted' ? t('exhaustedNote') : t('archivedNote')}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-2.5"
                    onClick={() => set({ status: 'draft' })}
                  >
                    {t('backToDraft')}
                  </Button>
                </div>
              ) : (
                <FieldSet label={t('statusLabel')} hint={t('statusHint')}>
                  <Segmented
                    value={draft.status}
                    label={t('statusLabel')}
                    onChange={(status) => set({ status: status as AdStatus })}
                    options={CHOOSABLE_STATUSES.filter((s) => s !== 'archived').map((s) => ({
                      value: s,
                      label: t(`status.${s}`),
                    }))}
                  />
                </FieldSet>
              )}

              <Field label={t('startsAt')} hint={t('timesUtc')} error={err('schedule')}>
                <input
                  type="datetime-local"
                  value={toUtcInput(draft.startsAt)}
                  onChange={(e) => set({ startsAt: fromUtcInput(e.target.value) })}
                  className={inputClass(false)}
                />
              </Field>
              <Field label={t('endsAt')} error={err('schedule')}>
                <input
                  type="datetime-local"
                  value={toUtcInput(draft.endsAt)}
                  onChange={(e) => set({ endsAt: fromUtcInput(e.target.value) })}
                  className={inputClass(Boolean(err('schedule')))}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title={t('rewardAndBudget')}>
            <div className="flex flex-col gap-3">
              {/* ⚠️ NOT A FIELD ANY MORE (operator, 2026-08-12: "dont let me
                  decide what a point is worth by an ad. use what is already
                  promised on the plan").

                  What an ad paid used to be the product of two numbers set in
                  different places on different days: this box and the plan's
                  multiplier. The pool held ads at 30, 40, 80 and 100, so a
                  Platinum member watching a 30-point ad was paid less than a
                  Bronze member watching a 100-point one, and the ladder was
                  not the promise it looked like.

                  Every ad now pays the platform base — the free plan's per-ad
                  value — and each member receives that times the rate their
                  plan and the amount they paid inside its range bought. The
                  number is set once, in Platform settings. */}
              <div className="rounded-(--radius-card) border border-ink-200 bg-ink-50/60 px-3.5 py-3">
                <p className="text-[0.8125rem] font-medium text-ink-900">
                  {t('rewardFixed', { points: draft.points })}
                </p>
                <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-500">
                  {t('rewardFixedHint')}
                </p>
              </div>

              <SwitchRow
                title={t('unlimited')}
                description={t('unlimitedHint')}
                checked={draft.maxCompletions === null}
                onChange={(on) => set({ maxCompletions: on ? null : Math.max(1, draft.completions || 1000) })}
              />

              {draft.maxCompletions !== null && (
                <Field
                  label={t('budget')}
                  suffix={t('units.completions')}
                  hint={t('budgetHint')}
                  error={err('budget')}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={draft.maxCompletions}
                    onChange={(e) => set({ maxCompletions: Number(e.target.value) })}
                    className={inputClass(Boolean(err('budget')), 'tabular-nums')}
                  />
                </Field>
              )}

              <Field label={t('weight')} hint={t('weightHint')} error={err('weight')}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={draft.weight}
                  onChange={(e) => set({ weight: Number(e.target.value) })}
                  className={inputClass(Boolean(err('weight')), 'tabular-nums')}
                />
              </Field>

              {/* The arithmetic nobody does by hand, and the reason an ad gets
                  paused: what the whole budget will cost if it fills. */}
              <dl className="rounded-(--radius-card) border border-ink-200 bg-ink-50/60 px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[0.6875rem] text-ink-500">{t('costTotal')}</dt>
                  <dd className="text-[0.9375rem] font-semibold text-ink-900 tabular-nums">
                    {liability === null ? t('unlimitedShort') : `GHS ${liability.toLocaleString()}`}
                  </dd>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-3">
                  <dt className="text-[0.6875rem] text-ink-500">{t('costEach')}</dt>
                  <dd className="text-[0.75rem] font-medium text-ink-600 tabular-nums">
                    GHS {(draft.points / pointsPerGhs).toFixed(3)}
                  </dd>
                </div>
                <p className="mt-2 text-[0.625rem] leading-relaxed text-ink-400">
                  {t('costNote')}
                </p>
              </dl>
            </div>
          </FormSection>

          {/* A summary of what this ad actually is, in the terms the player
              will use — the fastest way to notice a survey that grades an
              opinion or a video whose cue points went missing. */}
          <FormSection title={t('summary')}>
            <ul className="flex flex-col gap-1.5 text-[0.75rem] text-ink-600">
              {draft.format === 'link' ? (
                <>
                  <li>{t('summaryWords', { count: countWords(draft.articleBody) })}</li>
                  <li>{t('summaryDwell', { seconds: draft.minWatchSeconds ?? 0 })}</li>
                  <li>
                    {draft.ctaLinks.filter((l) => l.value.trim()).length === 1
                      ? t('summaryDestination')
                      : t('summaryNoDestination')}
                  </li>
                  {/* Said on the screen where the reward is set, because it is
                      the one thing about this format that cannot be fixed
                      later: the platform sees the click and nothing after it. */}
                  <li className="text-ink-400">{t('summaryLinkCaveat')}</li>
                </>
              ) : (
                <>
                  <li>{t('summaryQuestions', { count: draft.questions.length })}</li>
                  <li>
                    {t('summaryGraded', {
                      count: draft.questions.filter((q) =>
                        q.format === 'short_text'
                          ? Boolean(q.correctAnswer?.trim())
                          : q.options.some((o) => o.correct),
                      ).length,
                    })}
                  </li>
                  {draft.format === 'video' && (
                    <li>
                      {t('summaryCues', {
                        count: draft.questions.filter((q) => q.showAtSeconds !== null).length,
                      })}
                    </li>
                  )}
                  <li className={cn(hasBranching(draft.questions) && 'font-medium text-violet-700')}>
                    {hasBranching(draft.questions) ? t('summaryBranching') : t('summaryStraight')}
                  </li>
                </>
              )}
            </ul>
          </FormSection>

          {/* ---- Removal ------------------------------------------------ */}
          {!isNew && (
            <FormSection title={t('removal')}>
              {confirming ? (
                <div className="rounded-(--radius-card) border border-danger-500/30 bg-danger-50 p-3.5">
                  <p className="text-[0.8125rem] font-semibold text-danger-700">
                    {deletable ? t('confirmDelete') : t('confirmArchive')}
                  </p>
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-danger-700/90">
                    {deletable ? t('confirmDeleteBody') : t('confirmArchiveBody')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="danger" loading={saving} onClick={destroy}>
                      {deletable ? t('deleteNow') : t('archiveNow')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setConfirming(false)}
                    >
                      {t('keep')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-danger-700 hover:bg-danger-50"
                    onClick={() => setConfirming(true)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    {deletable ? t('delete') : t('archive')}
                  </Button>
                  <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-400">
                    {deletable ? t('deleteHint') : t('archiveHint')}
                  </p>
                </>
              )}
            </FormSection>
          )}
        </div>
      </div>

      {/*
        The phone's action bar. Sticky rather than fixed on purpose: the admin
        top bar has a backdrop-filter, and anything `fixed` rendered inside a
        filtered ancestor resolves against that ancestor rather than the
        viewport — the bug that once left the nav drawer 56px tall. Sticky
        answers to the scroll container, so it has none of that risk, and it
        comes to rest at the end of the form instead of covering the last
        field forever.
      */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-4 flex gap-2 border-t border-ink-200 bg-surface/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="flex-1"
          onClick={() => router.push('/admin/ads')}
        >
          {t('cancel')}
        </Button>
        <Button type="button" size="md" className="flex-1" loading={saving} onClick={submit}>
          <Check aria-hidden className="size-4" />
          {isNew ? t('create') : t('save')}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** Rough enough for the summary line — the operator wants to know whether the
 *  article is 60 words or 600, not its exact length. */
function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * ISO to the value a datetime-local input wants, in UTC.
 *
 * UTC on both sides on purpose: formatting in the viewer's timezone gives the
 * server and the first client render different strings, which is a hydration
 * mismatch. Ghana keeps GMT all year, so for this operator UTC is also simply
 * the right clock — and the field says so.
 */
function toUtcInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 16)
}

function fromUtcInput(value: string): string | null {
  if (!value) return null
  const d = new Date(`${value}:00Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
