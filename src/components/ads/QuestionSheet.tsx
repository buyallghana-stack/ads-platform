'use client'

import { useId } from 'react'

import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { AdQuestion } from '@/app/[locale]/(app)/ads/actions'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * One attention question.
 *
 * Shared by the video player, where it slides up over a paused video at the
 * second the admin chose, and by the survey runner, where it is the whole
 * screen. Same component either way so the two can never drift into answering
 * a question differently.
 *
 * No feedback is given here about whether the answer is right, and that is a
 * security property rather than a UX omission: correctness lives only in the
 * database (`is_correct` is structurally absent from everything the client can
 * fetch) and is decided in one graded submission at the end. A client that
 * could tell you "wrong, try again" would be a client that knew the answer.
 *
 * Options arrive pre-shuffled from the server on every attempt, so a user who
 * gets an ad wrong cannot memorise "it was the third one".
 */

export function QuestionSheet({
  question,
  step,
  value,
  onChange,
  onSubmit,
  submitting = false,
  submitLabel,
  opinionOnly = false,
  onBack,
}: {
  question: AdQuestion
  /** Position in a multi-question run. Omitted for a single mid-roll pop.
   *  `total` is absent on a branching survey, where the number of questions
   *  left genuinely depends on answers that have not been given yet. */
  step?: { n: number; total?: number }
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  submitting?: boolean
  submitLabel: string
  /** Nothing on this ad is graded, so no answer can be wrong. Shown to the
   *  respondent, because a survey that feels like a test gets test answers
   *  rather than honest ones. */
  opinionOnly?: boolean
  /** Survey only — a mid-video pop has nowhere to go back to. */
  onBack?: () => void
}) {
  const t = useTranslations('ads')
  const groupId = useId()
  const answered = value.trim().length > 0

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (answered && !submitting) onSubmit()
      }}
      /* ⚠️ A BOUNDED COLUMN, NOT A GROWING ONE (operator, 2026-08-12: with
         eight options "the question missed and it cant be scroll up or down").

         The sheet is anchored to the BOTTOM of the screen on a phone. A card
         with no ceiling therefore grows upwards, and once the options are
         taller than the screen the question leaves through the top of the
         viewport — where nothing can scroll it back, because the card was
         never a scroll container and the stage behind it does not move.

         So: the card is capped, the question and the buttons are pinned, and
         the OPTIONS are the only part that scrolls. Pinning the question
         rather than scrolling the whole card is the deliberate half — with a
         long list you want to see what you are answering while you answer
         it. */
      className="flex max-h-[80dvh] w-full flex-col gap-4 md:max-h-[70dvh]"
    >
      <div className="shrink-0">
        {step && (
          <div className="mb-2.5 flex items-center gap-2">
            {/* Segment per question rather than a single bar: on a five-part
                survey "which one am I on" is the question being asked, and
                segments answer it at a glance. */}
            {/* Segments only when the length is known. On a branching survey
                a bar that grows extra segments as you answer reads as the
                finish line moving away, so it just counts up instead. */}
            {step.total ? (
              <div className="flex flex-1 gap-1" aria-hidden>
                {Array.from({ length: step.total }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors duration-300',
                      i < step.n ? 'bg-brand-600' : 'bg-ink-200',
                    )}
                  />
                ))}
              </div>
            ) : (
              <div className="flex-1" />
            )}
            <span className="shrink-0 text-[0.6875rem] font-semibold text-ink-500 tabular-nums">
              {step.total
                ? t('question.step', { n: step.n, total: step.total })
                : t('question.stepOpen', { n: step.n })}
            </span>
          </div>
        )}

        <h2
          id={groupId}
          className="text-[1.0625rem] leading-snug font-semibold text-balance text-ink-900"
        >
          {question.text}
        </h2>

        {opinionOnly && (
          <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-400">
            {t('question.noWrongAnswer')}
          </p>
        )}
      </div>

      {question.format === 'multiple_choice' ? (
        /* `min-h-0` is what makes a flex child scrollable at all: without it
           the track refuses to shrink below its content and the overflow
           silently escapes the card again. `overscroll-contain` keeps a flick
           at the end of the list from dragging the page behind the sheet. */
        <div
          role="radiogroup"
          aria-labelledby={groupId}
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain"
        >
          {question.options.map((option) => {
            const selected = value === option.id
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(option.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-(--radius-input) border px-3.5 text-left',
                  // Generous target: this is tapped on a phone, often one-handed.
                  'min-h-12 py-2.5 pointer-coarse:min-h-13',
                  'text-[0.875rem] font-medium transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
                  selected
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-ink-200 bg-surface text-ink-700 hover:border-ink-300 hover:bg-ink-50',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
                    selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-ink-300 bg-surface',
                  )}
                >
                  {selected && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">{option.text}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div>
          <label htmlFor={`${groupId}-text`} className="sr-only">
            {question.text}
          </label>
          <input
            id={`${groupId}-text`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('question.placeholder')}
            autoComplete="off"
            // Free text is graded case-insensitively and trimmed server-side,
            // so the phone's habit of capitalising the first letter is
            // harmless — but turning it off still avoids a confusing display.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={cn(
              'h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5',
              'text-base text-ink-900 placeholder:text-ink-400',
              'transition-[border-color,box-shadow] duration-150',
              'hover:border-ink-300 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12 focus:outline-none',
            )}
          />
        </div>
      )}

      {/*
        A GRID BELOW `md`, NOT A FLEX ROW — and that is the whole bug fix.

        Submit used to carry `fullWidth`, which is `w-full`: 100% of the
        container, not "the space left over". Alone in the row that reads as
        full width and is right. Beside Back — the last question of a survey —
        it was still asking for 100%, and `Button` sets `shrink-0`, so it could
        not give any of it back. The row overran the sheet and the submit
        button was clipped at the screen edge: "too long and distorted".

        A grid track cannot overflow like that. `auto` for Back, `1fr` for
        Submit, and a grid item stretches to its track without any width
        utility at all — so `shrink-0` never enters into it. With no Back
        there is one full-width track, which keeps the thumb target a phone
        wants.

        FROM `md` it is a flex row again and the button sizes to its LABEL,
        against a floor rather than a fixed width. The old `min-w-[10rem]`
        forced 160px on every label, so "Next" sat marooned in the middle of a
        wide blue slab while "Continue watching" looked normal — one number
        cannot flatter both. 7.5rem is a floor a primary action does not fall
        below; anything longer simply grows past it.

        `lg` rather than the default `md` at every width: 40px was squat under
        a full-width fill, and this is the primary action of the whole screen.
      */}
      <div
        className={cn(
          'grid shrink-0 items-center gap-2',
          onBack ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1',
          'md:flex md:justify-end',
        )}
      >
        {onBack && (
          <Button
            type="button"
            size="lg"
            variant="ghost"
            onClick={onBack}
            disabled={submitting}
            className="md:mr-auto"
          >
            {t('question.back')}
          </Button>
        )}
        <Button
          type="submit"
          size="lg"
          disabled={!answered}
          loading={submitting}
          className="md:min-w-[7.5rem]"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
