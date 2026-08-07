'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { submitQuiz } from '@/app/[locale]/(affiliate)/learn/[slug]/actions'
import type { Quiz } from '@/lib/market/course'
import { cn } from '@/lib/cn'

/**
 * A checkpoint.
 *
 * ── IT IS A PROOF OF ATTENTION, NOT AN EXAM ──
 *
 * Retrying is encouraged and unlimited, which is why the failure state leads
 * with "try again" rather than with the score. Somebody who got three of five
 * wrong did not fail an assessment; they skimmed a page, and the correct
 * response is to send them back to it.
 *
 * That is also why the answer key never reaches this component. `quiz_for_
 * learner` and `lesson_for_learner` both omit `is_correct` — the grading
 * happens in `submit_quiz_attempt` and this only ever learns a score. Sending
 * the key down and comparing here would put the answers in view-source of
 * every checkpoint on a course that gates the ability to earn money.
 *
 * ── WHICH QUESTIONS WERE WRONG IS NOT SHOWN, AND THAT IS DELIBERATE ──
 *
 * Only the score comes back. Marking individual questions would let somebody
 * brute-force the key one submission at a time, which on an unlimited-retry
 * checkpoint is not a theoretical attack — it is faster than reading.
 */
export function LessonQuiz({ quiz, slug }: { quiz: Quiz; slug: string }) {
  const t = useTranslations('affiliate.quiz')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null)
  const [pending, startTransition] = useTransition()

  const answered = quiz.questions.filter((q) => answers[q.id]).length
  const complete = answered === quiz.questions.length

  const submit = () => {
    startTransition(async () => {
      const outcome = await submitQuiz(quiz.id, slug, answers)
      setResult(outcome)
    })
  }

  const retry = () => {
    setAnswers({})
    setResult(null)
  }

  return (
    <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[1rem] font-semibold text-ink-900">{quiz.title}</h2>
        <p className="text-[0.75rem] tabular-nums text-ink-500">
          {t('passMark', { n: quiz.pass_percent })}
        </p>
      </div>

      {result ? (
        <div
          className={cn(
            'mt-4 rounded-(--radius-card) border px-4 py-4 text-center',
            result.passed
              ? 'border-success-500/30 bg-success-50'
              : 'border-warning-500/30 bg-warning-50',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'mx-auto grid size-11 place-items-center rounded-full',
              result.passed
                ? 'bg-success-500/15 text-success-600'
                : 'bg-warning-500/15 text-warning-600',
            )}
          >
            {result.passed ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
          </span>
          <p className="mt-2.5 text-[1rem] font-semibold text-ink-900">
            {t(result.passed ? 'passedTitle' : 'failedTitle')}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-snug text-ink-600">
            {t(result.passed ? 'passedBody' : 'failedBody', { n: result.score })}
          </p>

          {/* ⚠️ OFFERED AFTER A PASS TOO. This was `!result.passed`, which meant
              passing a checkpoint sealed it for the rest of the session: the
              questions vanished behind a green card with no way back to them.
              A checkpoint is a proof of attention, not an exam sat once, and
              somebody who passed it in week one and wants to check themselves
              again in week four is doing exactly what it is for. Passing again
              cannot take anything away either — `record_lesson_progress` never
              un-completes a lesson. */}
          <button
            type="button"
            onClick={retry}
            className={cn(
              'mt-4 inline-flex items-center gap-2 rounded-(--radius-input) px-4 py-2.5',
              'text-[0.875rem] font-semibold transition-colors',
              result.passed
                ? 'border border-ink-300 text-ink-700 hover:bg-ink-50'
                : 'bg-brand-600 text-white hover:bg-brand-500',
            )}
          >
            <RotateCcw aria-hidden className="size-4" />
            {t(result.passed ? 'again' : 'retry')}
          </button>
        </div>
      ) : (
        <>
          <ol className="mt-4 flex flex-col gap-5">
            {quiz.questions.map((question, index) => (
              <li key={question.id}>
                <p className="text-[0.875rem] font-medium leading-snug text-ink-900">
                  <span className="mr-1.5 text-ink-400">{index + 1}.</span>
                  {question.prompt}
                </p>

                <div className="mt-2.5 flex flex-col gap-2" role="radiogroup" aria-label={question.prompt}>
                  {question.options.map((option) => {
                    const chosen = answers[question.id] === option.id
                    return (
                      <label
                        key={option.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-(--radius-input) border px-3 py-2.5 transition-colors',
                          chosen
                            ? 'border-brand-600 bg-brand-50'
                            : 'border-ink-200 hover:border-ink-300',
                        )}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={option.id}
                          checked={chosen}
                          onChange={() =>
                            setAnswers((prev) => ({ ...prev, [question.id]: option.id }))
                          }
                          className="mt-0.5 size-4 shrink-0 accent-brand-600"
                        />
                        <span className="text-[0.8125rem] leading-snug text-ink-800">
                          {option.body}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={submit}
            disabled={!complete || pending}
            className={cn(
              'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-(--radius-input) px-4 py-3',
              'text-[0.875rem] font-semibold transition-colors sm:w-auto',
              complete && !pending
                ? 'bg-brand-600 text-white hover:bg-brand-500'
                : 'cursor-not-allowed bg-ink-100 text-ink-400',
            )}
          >
            {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {/* The button says what is MISSING rather than sitting greyed with
                no explanation — on a five-question checkpoint, "one left" is
                the whole difference between a disabled control and a broken
                one. */}
            {complete
              ? t('submit')
              : t('answerRemaining', { n: quiz.questions.length - answered })}
          </button>
        </>
      )}
    </section>
  )
}
