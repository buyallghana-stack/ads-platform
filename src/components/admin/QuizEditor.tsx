'use client'

import { useState } from 'react'
import { Check, Clock, Plus, Trash2 } from 'lucide-react'

import { cn } from '@/lib/cn'

export type QuizOptionDraft = { id?: string; body: string; isCorrect: boolean }
export type QuizQuestionDraft = {
  id?: string
  prompt: string
  explanation?: string | null
  options: QuizOptionDraft[]
}
export type QuizDraft = {
  id?: string
  title: string
  /** Seconds into the video for a checkpoint; null for a section quiz. */
  atSeconds: number | null
  passPercent: number
  questions: QuizQuestionDraft[]
}

/**
 * One quiz, with its questions, options and answer key.
 *
 * ---------------------------------------------------------------------------
 * EXACTLY ONE CORRECT ANSWER, ENFORCED BY THE CONTROL
 *
 * The options are RADIOS, not checkboxes, so "two correct answers" is not a
 * state the operator can get into — choosing a second correct answer moves the
 * mark rather than adding one.
 *
 * That is not cosmetic. The learner's quiz sends a single option id per
 * question, so a second correct answer would be unreachable: it would sit in
 * the database looking like it counted while being impossible to choose. The
 * server action refuses it too, but a form that cannot express the mistake is
 * better than one that catches it afterwards.
 *
 * ---------------------------------------------------------------------------
 * A CHECKPOINT AND A SECTION QUIZ ARE THE SAME THING WITH ONE FIELD DIFFERENT
 *
 * `atSeconds` set means it interrupts a video at that moment; null means it is
 * the whole lesson. One editor covers both because they ARE one row — and the
 * learner-side component is a single component for the same reason.
 */
export function QuizEditor({
  quiz,
  lessonKind,
  onChange,
  onDelete,
  disabled,
}: {
  quiz: QuizDraft
  lessonKind: 'video' | 'article' | 'pdf' | 'quiz'
  onChange: (next: QuizDraft) => void
  onDelete: () => void
  disabled?: boolean
}) {
  const patch = (p: Partial<QuizDraft>) => onChange({ ...quiz, ...p })

  const setQuestion = (index: number, next: QuizQuestionDraft) =>
    patch({ questions: quiz.questions.map((q, i) => (i === index ? next : q)) })

  return (
    <div className="rounded-(--radius-card) border border-ink-200 bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2.5">
        <input
          value={quiz.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Quiz title"
          className="min-w-0 flex-1 rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-1.5 text-[0.875rem] font-semibold text-ink-900 pointer-coarse:text-base"
        />

        {/* Only a video can carry a checkpoint. On any other kind the quiz IS
            the lesson, so offering a timestamp would be offering a setting
            with nothing to attach to. */}
        {lessonKind === 'video' && (
          <label className="flex items-center gap-1.5 text-[0.75rem] text-ink-600">
            <Clock aria-hidden className="size-3.5 text-ink-400" />
            <span className="sr-only sm:not-sr-only">At</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={quiz.atSeconds ?? ''}
              onChange={(e) =>
                patch({ atSeconds: e.target.value === '' ? null : Number(e.target.value) })
              }
              placeholder="end"
              className="w-20 rounded-(--radius-input) border border-ink-200 bg-surface px-2 py-1.5 text-[0.8125rem] tabular-nums text-ink-900 pointer-coarse:text-base"
            />
            <span>s</span>
          </label>
        )}

        <label className="flex items-center gap-1.5 text-[0.75rem] text-ink-600">
          <span>Pass</span>
          <input
            type="number"
            min="1"
            max="100"
            inputMode="numeric"
            value={quiz.passPercent}
            onChange={(e) => patch({ passPercent: Number(e.target.value) })}
            className="w-16 rounded-(--radius-input) border border-ink-200 bg-surface px-2 py-1.5 text-[0.8125rem] tabular-nums text-ink-900 pointer-coarse:text-base"
          />
          <span>%</span>
        </label>

        <button
          type="button"
          aria-label="Delete this quiz"
          title="Delete this quiz"
          onClick={onDelete}
          disabled={disabled}
          className="grid size-8 place-items-center rounded-(--radius-input) text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:opacity-30"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </header>

      <div className="divide-y divide-ink-200">
        {quiz.questions.map((question, qi) => (
          <QuestionRow
            key={question.id ?? qi}
            index={qi}
            question={question}
            disabled={disabled}
            onChange={(next) => setQuestion(qi, next)}
            onDelete={() =>
              patch({ questions: quiz.questions.filter((_, i) => i !== qi) })
            }
          />
        ))}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          patch({
            questions: [
              ...quiz.questions,
              {
                prompt: '',
                /* Two blank options rather than none: a question needs at
                   least two, so starting with zero means the operator's first
                   act is always the same two clicks. */
                options: [
                  { body: '', isCorrect: true },
                  { body: '', isCorrect: false },
                ],
              },
            ],
          })
        }
        className="flex w-full items-center gap-2 px-3 py-2.5 text-[0.8125rem] font-medium text-brand-700 transition-colors hover:bg-ink-50 disabled:opacity-50"
      >
        <Plus aria-hidden className="size-4" />
        Add a question
      </button>
    </div>
  )
}

function QuestionRow({
  index,
  question,
  disabled,
  onChange,
  onDelete,
}: {
  index: number
  question: QuizQuestionDraft
  disabled?: boolean
  onChange: (next: QuizQuestionDraft) => void
  onDelete: () => void
}) {
  /* A stable name per question so the radios in ONE question form a group and
     the radios in another do not. Without it every option on the whole quiz
     would be mutually exclusive, and marking an answer in question two would
     silently unmark question one. */
  const [group] = useState(() => `q-${Math.random().toString(36).slice(2)}`)

  const patch = (p: Partial<QuizQuestionDraft>) => onChange({ ...question, ...p })

  return (
    <div className="px-3 py-3">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-4 shrink-0 text-[0.75rem] tabular-nums text-ink-400">
          {index + 1}
        </span>
        <textarea
          value={question.prompt}
          onChange={(e) => patch({ prompt: e.target.value })}
          rows={2}
          placeholder="What do you want to ask?"
          className="min-w-0 flex-1 resize-y rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.875rem] text-ink-900 pointer-coarse:text-base"
        />
        <button
          type="button"
          aria-label="Delete this question"
          title="Delete this question"
          onClick={onDelete}
          disabled={disabled}
          className="mt-1 grid size-8 shrink-0 place-items-center rounded-(--radius-input) text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:opacity-30"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>

      <ul className="mt-2 space-y-1.5 pl-6">
        {question.options.map((option, oi) => (
          <li key={option.id ?? oi} className="flex items-center gap-2">
            <input
              type="radio"
              name={group}
              checked={option.isCorrect}
              aria-label={`Option ${oi + 1} is the correct answer`}
              onChange={() =>
                patch({
                  options: question.options.map((o, i) => ({ ...o, isCorrect: i === oi })),
                })
              }
              className="size-4 shrink-0 accent-success-600"
            />
            <input
              value={option.body}
              onChange={(e) =>
                patch({
                  options: question.options.map((o, i) =>
                    i === oi ? { ...o, body: e.target.value } : o,
                  ),
                })
              }
              placeholder={`Option ${oi + 1}`}
              className={cn(
                'min-w-0 flex-1 rounded-(--radius-input) border bg-surface px-3 py-1.5',
                'text-[0.875rem] text-ink-900 pointer-coarse:text-base',
                option.isCorrect ? 'border-success-500/40' : 'border-ink-200',
              )}
            />
            {option.isCorrect && (
              <Check aria-hidden className="size-4 shrink-0 text-success-600" />
            )}
            {/* Below two options a question is unpublishable, so the remove
                control simply is not offered at two. */}
            {question.options.length > 2 && (
              <button
                type="button"
                aria-label={`Remove option ${oi + 1}`}
                onClick={() => {
                  const rest = question.options.filter((_, i) => i !== oi)
                  // If the correct one was removed, the mark has to land
                  // somewhere or the question becomes unpublishable silently.
                  if (!rest.some((o) => o.isCorrect) && rest[0]) rest[0].isCorrect = true
                  patch({ options: rest })
                }}
                className="grid size-7 shrink-0 place-items-center rounded-(--radius-input) text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
              >
                <Trash2 aria-hidden className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() =>
          patch({ options: [...question.options, { body: '', isCorrect: false }] })
        }
        className="mt-1.5 ml-6 text-[0.75rem] font-medium text-brand-700 hover:underline"
      >
        Add an option
      </button>
    </div>
  )
}
