'use client'

import { useState } from 'react'
import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import type { Quiz } from '@/lib/market/course'

/**
 * A quiz, whether it fires inside a video or stands alone as a section quiz.
 *
 * One component for both, because they are the same interaction — the only
 * difference is what surrounds it and whether a video is waiting behind it.
 *
 * ---------------------------------------------------------------------------
 * WHY A WRONG ANSWER IS NOT A FAILURE
 *
 * Passing this can complete a lesson; completing lessons crosses the
 * activation threshold; crossing it makes somebody an affiliate who can earn
 * real money. That chain is exactly why the quiz must be unskippable — and
 * exactly why it must be retryable.
 *
 * An unretryable question that costs somebody their affiliate status is a
 * support ticket every single time, and an angry one, because they paid for
 * the course. This is a checkpoint proving attention, not an exam.
 *
 * ---------------------------------------------------------------------------
 * THE MARKING HAPPENS ON THE SERVER
 *
 * `onSubmit` posts the chosen option ids and receives a score. The answer key
 * is never sent to the browser — `lesson_for_learner` returns options without
 * `is_correct` on purpose. A browser-marked quiz would be a browser-granted
 * right to earn.
 *
 * Which means this component cannot show WHICH answer was wrong, only that the
 * attempt did not pass. That is a real cost, accepted deliberately: telling
 * somebody which one they got wrong requires either shipping the key or a
 * second round trip that reveals it question by question, and both hand over
 * the thing that must not be handed over.
 */
export function LessonQuiz({
  quiz,
  onSubmit,
  onPassed,
  onDismiss,
  variant,
}: {
  quiz: Quiz
  onSubmit: (answers: Record<string, string>) => Promise<{ score: number; passed: boolean }>
  /** Fired after a pass — resumes the video, or completes the lesson. */
  onPassed: () => void
  /** Only offered where skipping is legitimate: a preview lesson. */
  onDismiss?: () => void
  /** `checkpoint` sits in the video's rectangle; `standalone` is a page. */
  variant: 'checkpoint' | 'standalone'
}) {
  const t = useTranslations('market.quiz')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const answered = quiz.questions.every((q) => answers[q.id])

  async function submit() {
    if (!answered || busy) return
    setBusy(true)
    try {
      const outcome = await onSubmit(answers)
      setResult(outcome)
    } finally {
      setBusy(false)
    }
  }

  function retry() {
    setAnswers({})
    setResult(null)
  }

  return (
    <div
      className={cn(
        'flex flex-col',
        // A checkpoint fills the video's box exactly, so nothing on the page
        // moves when it appears. Its own scroll, because a long question on a
        // short phone must not push the list around.
        variant === 'checkpoint'
          ? 'max-h-[70vh] overflow-y-auto bg-ink-900 px-4 py-5 text-ink-50 lg:px-6'
          : 'rounded-(--radius-card) border border-ink-200 bg-surface p-4 md:p-6',
      )}
    >
      <p
        className={cn(
          'text-[0.75rem] font-semibold tracking-wide uppercase',
          variant === 'checkpoint' ? 'text-jade-600' : 'text-jade-700',
        )}
      >
        {variant === 'checkpoint' ? t('checkpoint') : t('sectionQuiz')}
      </p>
      <h2
        className={cn(
          'mt-1 text-base leading-snug font-semibold md:text-lg',
          variant === 'checkpoint' ? 'text-white' : 'text-ink-900',
        )}
      >
        {quiz.title}
      </h2>

      {result?.passed ? (
        <Outcome
          passed
          variant={variant}
          title={t('passed.title')}
          body={t('passed.body', { score: result.score })}
          actionLabel={variant === 'checkpoint' ? t('passed.resume') : t('passed.next')}
          onAction={onPassed}
        />
      ) : result ? (
        <Outcome
          passed={false}
          variant={variant}
          title={t('failed.title')}
          body={t('failed.body', { score: result.score, pass: quiz.pass_percent })}
          actionLabel={t('failed.retry')}
          onAction={retry}
        />
      ) : (
        <>
          <ol className="mt-4 space-y-5">
            {quiz.questions.map((question, qi) => (
              <li key={question.id}>
                <p
                  className={cn(
                    'text-[0.9375rem] leading-snug font-medium',
                    variant === 'checkpoint' ? 'text-ink-50' : 'text-ink-900',
                  )}
                >
                  <span className="mr-1.5 tabular-nums opacity-60">{qi + 1}.</span>
                  {question.prompt}
                </p>
                <div className="mt-2.5 space-y-2">
                  {question.options.map((option) => {
                    const chosen = answers[question.id] === option.id
                    return (
                      <label
                        key={option.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-(--radius-input) border px-3 py-2.5',
                          'text-[0.9375rem] leading-snug transition-colors',
                          // 16px on touch or mobile Safari zooms and does not
                          // zoom back — the platform rule, and a radio label
                          // is as much a control as an input.
                          'pointer-coarse:text-base',
                          variant === 'checkpoint'
                            ? chosen
                              ? 'border-jade-600 bg-jade-600/15 text-white'
                              : 'border-ink-700 text-ink-200 hover:border-ink-600'
                            : chosen
                              ? 'border-jade-600 bg-jade-50 text-ink-900'
                              : 'border-ink-200 text-ink-700 hover:border-ink-300',
                        )}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          checked={chosen}
                          onChange={() =>
                            setAnswers((a) => ({ ...a, [question.id]: option.id }))
                          }
                          className="mt-1 size-4 shrink-0 accent-jade-600"
                        />
                        <span>{option.body}</span>
                      </label>
                    )
                  })}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={!answered || busy}
              className={cn(
                'rounded-(--radius-input) px-4 py-2.5 text-sm font-semibold transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'bg-jade-600 text-white hover:bg-jade-700',
              )}
            >
              {busy ? t('checking') : t('submit')}
            </button>
            {/* Only ever rendered for a preview lesson. There is no skip on a
                paid lesson — that is the whole point of the checkpoint. */}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="text-sm font-medium text-ink-400 underline-offset-2 hover:underline"
              >
                {t('skipPreview')}
              </button>
            )}
            {!answered && (
              <p
                className={cn(
                  'text-[0.8125rem]',
                  variant === 'checkpoint' ? 'text-ink-400' : 'text-ink-500',
                )}
              >
                {t('answerAll')}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Outcome({
  passed,
  variant,
  title,
  body,
  actionLabel,
  onAction,
}: {
  passed: boolean
  variant: 'checkpoint' | 'standalone'
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  const Icon = passed ? CheckCircle2 : XCircle
  return (
    <div className="mt-5 flex flex-1 flex-col items-start">
      <span
        className={cn(
          'flex items-center gap-2 text-sm font-semibold',
          passed ? 'text-jade-600' : 'text-danger-600',
        )}
      >
        <Icon aria-hidden className="size-5" strokeWidth={2.2} />
        {title}
      </span>
      <p
        className={cn(
          'mt-1.5 text-[0.9375rem] leading-snug',
          variant === 'checkpoint' ? 'text-ink-300' : 'text-ink-600',
        )}
      >
        {body}
      </p>
      <button
        type="button"
        onClick={onAction}
        className={cn(
          'mt-4 flex items-center gap-2 rounded-(--radius-input) px-4 py-2.5 text-sm font-semibold',
          'transition-colors',
          passed
            ? 'bg-jade-600 text-white hover:bg-jade-700'
            : 'bg-ink-100 text-ink-800 hover:bg-ink-200',
        )}
      >
        {!passed && <RotateCcw aria-hidden className="size-4" />}
        {actionLabel}
      </button>
    </div>
  )
}
