'use client'

import { ArrowDown, ArrowUp, CornerDownRight, GitBranch, Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { blankOption, blankQuestion, draftKey, isGraded, type AdErrors } from '@/lib/admin/ad-draft'
import type { AdDraft, AdQuestionDraft, AdRuleDraft } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { Field, FieldSet, inputClass, Segmented, SwitchRow } from './FormBits'

/**
 * The question builder — the part of the editor the operator actually came
 * for, and the part that has to teach as it goes.
 *
 * THREE PRODUCT RULES ARE VISIBLE IN THIS FORM, NOT HIDDEN BEHIND IT
 *
 * 1. A SURVEY IS NOT A QUIZ. A question is graded only if an answer key
 *    exists for it; with none, any answer is accepted and still recorded.
 *    That is expressed as a choice the operator makes on purpose — "No right
 *    answer" is a real option in the list, selected by default — because the
 *    old model, where every question silently demanded a correct choice, is
 *    what told an honest respondent they were wrong about their own opinion.
 *
 * 2. WHEN a question is asked is the admin's decision, not the video's. A cue
 *    point interrupts playback at a chosen second; with none, the question
 *    waits for the end. Any number of cues per ad.
 *
 * 3. A QUESTION MAY DEPEND ON AN EARLIER ANSWER. The operator's example was
 *    the one to avoid: never ask "how do you feel being a girl" of someone
 *    who said they were a boy. So the rule builder only ever offers EARLIER
 *    questions — the database enforces that with a trigger, and offering a
 *    later one here would be building a form whose output the database
 *    rejects.
 *
 * Skipping cascades, which is worth knowing while reading this: hiding a
 * question also hides everything gated on it, because a rule whose subject
 * was never shown cannot pass. The summary line under each conditional
 * question says what it depends on, so a chain is readable without
 * reconstructing it.
 */

export function AdQuestions({
  draft,
  errors,
  onChange,
}: {
  draft: AdDraft
  errors: AdErrors
  onChange: (questions: AdQuestionDraft[]) => void
}) {
  const t = useTranslations('admin.ads.editor')

  const video = draft.format === 'video'
  const locked = draft.questionsLocked

  const set = (key: string, patch: Partial<AdQuestionDraft>) =>
    onChange(draft.questions.map((q) => (q.key === key ? { ...q, ...patch } : q)))

  const add = () => onChange([...draft.questions, blankQuestion(draft.format)])

  /**
   * The one-tap way to branch: "ask a follow-up when they pick this answer".
   *
   * Branching used to be reachable only by adding a second question and
   * finding the rule builder inside it, which the operator did not see at all
   * on a survey they built from scratch. Starting from the ANSWER is also how
   * people think about it — "if they say Yes, then ask…" — so the new question
   * arrives already gated on that option, at the end of the list where a rule
   * pointing backwards is always valid.
   */
  const addFollowUp = (question: AdQuestionDraft, optionKey: string) => {
    const follow = blankQuestion(draft.format)
    follow.rules = [
      {
        key: draftKey('r'),
        dependsOn: question.key,
        optionKey,
        valueText: null,
        negate: false,
      },
    ]
    onChange([...draft.questions, follow])
  }

  /**
   * Removing a question takes its dependents' rules with it. A rule pointing
   * at a question that no longer exists is a question that can never be
   * shown, and silently leaving one behind would make a survey disappear for
   * every respondent with no visible cause.
   */
  const remove = (key: string) =>
    onChange(
      draft.questions
        .filter((q) => q.key !== key)
        .map((q) => ({ ...q, rules: q.rules.filter((r) => r.dependsOn !== key) })),
    )

  const move = (index: number, by: -1 | 1) => {
    const next = [...draft.questions]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    // Rules that now point forwards are flagged by validateAd rather than
    // silently dropped: the operator moved the question deliberately and is
    // owed the chance to re-point the rule instead of losing it.
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {locked && (
        <p className="rounded-(--radius-card) border border-warning-500/30 bg-warning-50 px-3.5 py-3 text-[0.75rem] leading-relaxed text-warning-600">
          {t('questionsLocked', { count: draft.completions })}
        </p>
      )}

      {draft.questions.length === 0 && (
        <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-8 text-center text-[0.8125rem] leading-relaxed text-ink-400">
          {video ? t('noQuestionsVideo') : t('noQuestionsSurvey')}
        </p>
      )}

      {draft.questions.map((question, index) => (
        <QuestionCard
          key={question.key}
          question={question}
          index={index}
          earlier={draft.questions.slice(0, index)}
          video={video}
          duration={draft.durationSeconds}
          locked={locked}
          errors={errors}
          last={index === draft.questions.length - 1}
          onChange={(patch) => set(question.key, patch)}
          onRemove={() => remove(question.key)}
          onMove={(by) => move(index, by)}
          onFollowUp={(optionKey) => addFollowUp(question, optionKey)}
        />
      ))}

      {errors.questions && (
        <p role="alert" className="text-[0.75rem] font-medium text-danger-600">
          {t(`errors.${errors.questions}`)}
        </p>
      )}

      {!locked && (
        <Button type="button" variant="secondary" size="md" onClick={add} className="self-start">
          <Plus aria-hidden className="size-4" />
          {t('addQuestion')}
        </Button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function QuestionCard({
  question,
  index,
  earlier,
  video,
  duration,
  locked,
  errors,
  last,
  onChange,
  onRemove,
  onMove,
  onFollowUp,
}: {
  question: AdQuestionDraft
  index: number
  /** The only questions a rule may depend on. */
  earlier: AdQuestionDraft[]
  video: boolean
  duration: number | null
  locked: boolean
  errors: AdErrors
  last: boolean
  onChange: (patch: Partial<AdQuestionDraft>) => void
  onRemove: () => void
  onMove: (by: -1 | 1) => void
  /** Add a new question gated on one of this question's options. */
  onFollowUp: (optionKey: string) => void
}) {
  const t = useTranslations('admin.ads.editor')
  const err = (field: string) => {
    const key = errors[`q.${question.key}.${field}`]
    return key ? t(`errors.${key}`) : undefined
  }

  const graded = isGraded(question)
  const multi = question.format === 'multiple_choice'
  const correctKey = question.options.find((o) => o.correct)?.key ?? ''

  const setOption = (key: string, patch: Partial<{ text: string; correct: boolean }>) =>
    onChange({ options: question.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) })

  /** Exactly one option may be the key — the database has a unique index for
   *  it — so choosing one clears the rest, and choosing "none" makes the
   *  question an opinion. */
  const setCorrect = (key: string) =>
    onChange({ options: question.options.map((o) => ({ ...o, correct: o.key === key })) })

  const removeOption = (key: string) =>
    onChange({
      options: question.options.filter((o) => o.key !== key),
    })

  return (
    <article className="rounded-(--radius-card) border border-ink-200 bg-canvas p-3.5 sm:p-4">
      {/* ---- Header --------------------------------------------------- */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[0.8125rem] font-semibold text-ink-900">
            {t('questionN', { n: index + 1 })}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[0.625rem] font-semibold',
              graded
                ? 'bg-brand-50 text-brand-700'
                : 'bg-ink-100 text-ink-500',
            )}
          >
            {graded ? t('graded') : t('opinion')}
          </span>
          {question.rules.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[0.625rem] font-semibold text-violet-700">
              <GitBranch aria-hidden className="size-3" />
              {t('conditional')}
            </span>
          )}
          {video && question.showAtSeconds !== null && (
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.625rem] font-semibold text-ink-600 tabular-nums">
              {t('atSecond', { seconds: question.showAtSeconds })}
            </span>
          )}
        </div>

        {!locked && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label={t('moveUp')} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp aria-hidden />
            </IconButton>
            <IconButton label={t('moveDown')} disabled={last} onClick={() => onMove(1)}>
              <ArrowDown aria-hidden />
            </IconButton>
            <IconButton label={t('removeQuestion')} danger onClick={onRemove}>
              <Trash2 aria-hidden />
            </IconButton>
          </div>
        )}
      </div>

      {/* ---- The question --------------------------------------------- */}
      <Field label={t('questionText')} error={err('text')}>
        <textarea
          rows={2}
          value={question.text}
          disabled={locked}
          maxLength={500}
          placeholder={t('questionPlaceholder')}
          onChange={(e) => onChange({ text: e.target.value })}
          className={inputClass(Boolean(err('text')), 'h-auto resize-none py-2')}
        />
      </Field>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FieldSet label={t('answerType')}>
          <Segmented
            value={question.format}
            disabled={locked}
            label={t('answerType')}
            onChange={(format) =>
              onChange({
                format,
                // The two shapes do not share an answer key, and carrying one
                // across would leave an invisible grade on the other.
                correctAnswer: null,
                options:
                  format === 'multiple_choice' && question.options.length === 0
                    ? [blankOption(), blankOption()]
                    : question.options.map((o) => ({ ...o, correct: false })),
                rules: [],
              })
            }
            options={[
              { value: 'multiple_choice', label: t('multipleChoice') },
              { value: 'short_text', label: t('shortText') },
            ]}
          />
        </FieldSet>

        {video && (
          <FieldSet
            label={t('whenAsked')}
            hint={question.showAtSeconds === null ? t('cueEndHint') : t('cueHint')}
            error={err('cue')}
          >
            <div className="flex gap-2">
              <Segmented
                value={question.showAtSeconds === null ? 'end' : 'cue'}
                disabled={locked}
                label={t('whenAsked')}
                className="flex-1"
                onChange={(mode) =>
                  onChange({
                    showAtSeconds:
                      mode === 'end' ? null : Math.min(10, duration ?? 10),
                  })
                }
                options={[
                  { value: 'end', label: t('atEnd') },
                  { value: 'cue', label: t('atTime') },
                ]}
              />
              {question.showAtSeconds !== null && (
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={duration ?? undefined}
                  value={question.showAtSeconds}
                  disabled={locked}
                  aria-label={t('cueSeconds')}
                  onChange={(e) => onChange({ showAtSeconds: Math.max(0, Number(e.target.value)) })}
                  className={inputClass(Boolean(err('cue')), 'w-20 shrink-0 tabular-nums')}
                />
              )}
            </div>
          </FieldSet>
        )}
      </div>

      {/* ---- Answers --------------------------------------------------- */}
      {multi ? (
        <div className="mt-3">
          <p className="text-[0.75rem] font-medium text-ink-700">{t('options')}</p>
          <p className="mt-0.5 text-[0.625rem] leading-snug text-ink-400">{t('optionsHint')}</p>
          {!locked && (
            <p className="mt-0.5 text-[0.625rem] leading-snug text-violet-700">
              {t('followUpHint')}
            </p>
          )}

          <ul className="mt-2 flex flex-col gap-2">
            {question.options.map((option, i) => (
              <li key={option.key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${question.key}`}
                  checked={option.correct}
                  disabled={locked}
                  aria-label={t('markCorrect', { n: i + 1 })}
                  onChange={() => setCorrect(option.key)}
                  className="size-4 shrink-0 accent-brand-600"
                />
                <input
                  value={option.text}
                  disabled={locked}
                  maxLength={200}
                  placeholder={t('optionPlaceholder', { n: i + 1 })}
                  onChange={(e) => setOption(option.key, { text: e.target.value })}
                  className={inputClass(Boolean(err('options')))}
                />
                {!locked && (
                  <IconButton
                    label={t('addFollowUp', { option: option.text.trim() || t('optionPlaceholder', { n: i + 1 }) })}
                    onClick={() => onFollowUp(option.key)}
                    violet
                  >
                    <CornerDownRight aria-hidden />
                  </IconButton>
                )}
                {!locked && question.options.length > 2 && (
                  <IconButton label={t('removeOption')} onClick={() => removeOption(option.key)}>
                    <Trash2 aria-hidden />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!locked && (
              <>
                <button
                  type="button"
                  onClick={() => onChange({ options: [...question.options, blankOption()] })}
                  className="inline-flex items-center gap-1 rounded-(--radius-input) border border-ink-200 bg-surface px-2.5 py-1.5 text-[0.75rem] font-semibold text-ink-600 transition-colors hover:text-ink-900"
                >
                  <Plus aria-hidden className="size-3.5" />
                  {t('addOption')}
                </button>
                <button
                  type="button"
                  onClick={() => setCorrect('')}
                  disabled={correctKey === ''}
                  className="rounded-(--radius-input) px-2.5 py-1.5 text-[0.75rem] font-medium text-ink-500 transition-colors hover:text-ink-900 disabled:opacity-40"
                >
                  {t('noRightAnswer')}
                </button>
              </>
            )}
          </div>

          {err('options') && (
            <p role="alert" className="mt-1.5 text-[0.6875rem] font-medium text-danger-600">
              {err('options')}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <SwitchRow
            title={t('gradeAnswer')}
            description={t('gradeAnswerHint')}
            checked={question.correctAnswer !== null}
            disabled={locked}
            onChange={(on) => onChange({ correctAnswer: on ? '' : null })}
          />
          {question.correctAnswer !== null && (
            <Field label={t('acceptedAnswer')} hint={t('acceptedAnswerHint')} error={err('answer')}>
              <input
                value={question.correctAnswer}
                disabled={locked}
                onChange={(e) => onChange({ correctAnswer: e.target.value })}
                className={inputClass(Boolean(err('answer')))}
              />
            </Field>
          )}
        </div>
      )}

      {/* ---- Skip logic ------------------------------------------------
          Rendered on EVERY question, including the first. The operator built
          a survey from scratch and reported that branching "does not show up"
          — it was there, but only from question two, so on a one-question
          draft there was nothing to find. The first question says why it is
          always asked instead of hiding the idea. */}
      {index === 0 ? (
        <p className="mt-3 border-t border-ink-200 pt-3 text-[0.6875rem] leading-relaxed text-ink-400">
          {t('firstAlwaysAsked')}
        </p>
      ) : (
        <Conditions
          question={question}
          earlier={earlier}
          locked={locked}
          error={err('rules')}
          onChange={onChange}
        />
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ */

function Conditions({
  question,
  earlier,
  locked,
  error,
  onChange,
}: {
  question: AdQuestionDraft
  earlier: AdQuestionDraft[]
  locked: boolean
  error?: string
  onChange: (patch: Partial<AdQuestionDraft>) => void
}) {
  const t = useTranslations('admin.ads.editor')
  const on = question.rules.length > 0

  const newRule = (): AdRuleDraft => {
    const subject = earlier[earlier.length - 1]
    return {
      key: draftKey('r'),
      dependsOn: subject.key,
      optionKey:
        subject.format === 'multiple_choice' ? (subject.options[0]?.key ?? null) : null,
      valueText: subject.format === 'short_text' ? '' : null,
      negate: false,
    }
  }

  const setRule = (key: string, patch: Partial<AdRuleDraft>) =>
    onChange({ rules: question.rules.map((r) => (r.key === key ? { ...r, ...patch } : r)) })

  /**
   * The rule in the operator's own words: "Asked only when Q1 is Woman".
   * Reading three dropdowns back as a sentence is what tells them the branch
   * they built is the branch they meant.
   */
  const summary = question.rules
    .map((rule) => {
      const at = earlier.findIndex((q) => q.key === rule.dependsOn)
      const subject = earlier[at]
      const answer =
        subject?.format === 'short_text'
          ? (rule.valueText ?? '')
          : (subject?.options.find((o) => o.key === rule.optionKey)?.text ?? '')
      return t(rule.negate ? 'ruleIsNot' : 'ruleIs', {
        n: at + 1,
        answer: answer.trim() || '…',
      })
    })
    .join(t(question.conditionMode === 'any' ? 'orJoin' : 'andJoin'))

  return (
    <div className="mt-3 border-t border-ink-200 pt-3">
      {/* A two-way choice rather than a switch: "Always" is a real answer an
          operator picks, not the absence of a setting, and seeing both makes
          branching discoverable on a question that has none. */}
      <FieldSet label={t('conditionsTitle')} hint={on ? undefined : t('conditionsHint')}>
        <Segmented
          value={on ? 'only' : 'always'}
          disabled={locked}
          label={t('conditionsTitle')}
          onChange={(mode) => onChange({ rules: mode === 'only' ? [newRule()] : [] })}
          options={[
            { value: 'always', label: t('askAlways') },
            { value: 'only', label: t('askOnlyIf') },
          ]}
        />
      </FieldSet>

      {on && summary && (
        <p className="mt-2 inline-flex items-start gap-1.5 rounded-(--radius-input) bg-violet-50 px-2.5 py-1.5 text-[0.6875rem] leading-snug font-medium text-violet-700">
          <GitBranch aria-hidden className="mt-px size-3 shrink-0" />
          {t('shownWhen', { rule: summary })}
        </p>
      )}

      {on && (
        <div className="mt-2 flex flex-col gap-2 rounded-(--radius-card) border border-violet-600/20 bg-violet-50/40 p-3">
          {question.rules.length > 1 && (
            <Segmented
              value={question.conditionMode}
              disabled={locked}
              label={t('matchMode')}
              onChange={(conditionMode) => onChange({ conditionMode })}
              options={[
                { value: 'all', label: t('matchAll') },
                { value: 'any', label: t('matchAny') },
              ]}
            />
          )}

          {/*
            One condition is a small stacked form, not a sentence laid out in
            a row. On a phone the row version wrapped into "If [question]" /
            "[is] [answer]" / a stranded bin icon on its own line — three
            fragments that no longer read as one rule. Stacked with a labelled
            head it survives any width, and from `sm` the two short controls
            sit side by side again.
          */}
          {question.rules.map((rule) => {
            const subject = earlier.find((q) => q.key === rule.dependsOn)

            return (
              <div
                key={rule.key}
                className="rounded-(--radius-input) border border-violet-600/20 bg-surface p-2.5"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[0.625rem] font-semibold tracking-[0.05em] text-violet-700 uppercase">
                    {t('ifAnswerTo')}
                  </span>
                  {!locked && (
                    <IconButton
                      label={t('removeCondition')}
                      onClick={() =>
                        onChange({ rules: question.rules.filter((r) => r.key !== rule.key) })
                      }
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <select
                    value={rule.dependsOn}
                    disabled={locked}
                    aria-label={t('ifAnswerTo')}
                    onChange={(e) => {
                      const next = earlier.find((q) => q.key === e.target.value)
                      setRule(rule.key, {
                        dependsOn: e.target.value,
                        optionKey:
                          next?.format === 'multiple_choice' ? (next.options[0]?.key ?? null) : null,
                        valueText: next?.format === 'short_text' ? '' : null,
                      })
                    }}
                    className={inputClass(false, 'h-9 pr-8')}
                  >
                    {earlier.map((q, i) => (
                      <option key={q.key} value={q.key}>
                        {t('questionN', { n: i + 1 })} · {q.text.trim() || t('untitledQuestion')}
                      </option>
                    ))}
                  </select>

                  <div className="flex min-w-0 gap-2">
                    <select
                      value={rule.negate ? 'isNot' : 'is'}
                      disabled={locked}
                      aria-label={t('comparison')}
                      onChange={(e) => setRule(rule.key, { negate: e.target.value === 'isNot' })}
                      className={inputClass(false, 'h-9 w-[6.5rem] shrink-0 pr-7')}
                    >
                      <option value="is">{t('is')}</option>
                      <option value="isNot">{t('isNot')}</option>
                    </select>

                    {subject?.format === 'short_text' ? (
                      <input
                        value={rule.valueText ?? ''}
                        disabled={locked}
                        placeholder={t('typedAnswer')}
                        aria-label={t('typedAnswer')}
                        onChange={(e) => setRule(rule.key, { valueText: e.target.value })}
                        className={inputClass(false, 'h-9 min-w-0 flex-1')}
                      />
                    ) : (
                      <select
                        value={rule.optionKey ?? ''}
                        disabled={locked}
                        aria-label={t('chosenOption')}
                        onChange={(e) => setRule(rule.key, { optionKey: e.target.value })}
                        className={inputClass(false, 'h-9 min-w-0 flex-1 pr-8')}
                      >
                        {(subject?.options ?? []).map((o, i) => (
                          <option key={o.key} value={o.key}>
                            {o.text.trim() || t('optionPlaceholder', { n: i + 1 })}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {!locked && (
            <button
              type="button"
              onClick={() => onChange({ rules: [...question.rules, newRule()] })}
              className="inline-flex items-center gap-1 self-start rounded-(--radius-input) border border-violet-600/30 bg-surface px-2.5 py-1.5 text-[0.75rem] font-semibold text-violet-700 transition-colors hover:bg-violet-50"
            >
              <Plus aria-hidden className="size-3.5" />
              {t('addCondition')}
            </button>
          )}

          <p className="text-[0.625rem] leading-relaxed text-violet-700/80">{t('cascadeNote')}</p>

          {error && (
            <p role="alert" className="text-[0.6875rem] font-medium text-danger-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  violet,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  violet?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-(--radius-input) transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-30 [&>svg]:size-3.5',
        danger
          ? 'text-danger-600 hover:bg-danger-50'
          : violet
            ? 'text-violet-600 hover:bg-violet-50'
            : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900',
      )}
    >
      {children}
    </button>
  )
}
