'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Field, FieldSet, FormSection, Segmented, SwitchRow, inputClass } from '@/components/admin/FormBits'
import { LessonMedia } from '@/components/admin/LessonMedia'
import { QuizEditor, type QuizDraft } from '@/components/admin/QuizEditor'
import type { LessonDetail } from '@/lib/admin/catalogue-data'
import {
  deleteQuizAction,
  saveLessonAction,
  saveQuestionAction,
  saveQuizAction,
} from '@/app/[locale]/admin/(super)/catalogue/actions'

/**
 * One lesson: what it is, what is in it, and the quizzes attached to it.
 *
 * ---------------------------------------------------------------------------
 * THE KIND DECIDES THE FORM
 *
 * Four kinds share one table, so a naive editor would show every field for
 * every kind and let the constraints sort it out at publish. Instead each kind
 * shows only the content it actually has:
 *
 *   video    a file, a length, and any number of in-video checkpoints
 *   article  the text
 *   pdf      attached resources
 *   quiz     one quiz, and no timestamp — the quiz IS the lesson
 *
 * `lesson_is_ready` enforces exactly this, so the form and the publish check
 * agree by construction rather than by two people remembering the same rule.
 *
 * ---------------------------------------------------------------------------
 * QUIZZES SAVE ONE AT A TIME, NOT WITH THE LESSON
 *
 * A quiz has its own id, its questions have their own ids, and the RPCs write
 * them individually. Batching the whole tree into the lesson save would mean
 * inventing a diff — which questions were removed, which options moved — and
 * getting it subtly wrong in a way that silently drops an answer key.
 */
export function LessonEditor({ detail }: { detail: LessonDetail }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const lesson = detail.lesson!
  const [form, setForm] = useState({
    title: lesson.title,
    kind: lesson.kind,
    body: lesson.body ?? '',
    storagePath: lesson.storagePath,
    durationSeconds: lesson.durationSeconds,
    isPreview: lesson.isPreview,
  })

  const [quizzes, setQuizzes] = useState<QuizDraft[]>(
    (detail.quizzes ?? []).map((q) => ({
      id: q.id,
      title: q.title,
      atSeconds: q.atSeconds,
      passPercent: q.passPercent,
      questions: q.questions.map((qq) => ({
        id: qq.id,
        prompt: qq.prompt,
        explanation: qq.explanation,
        options: qq.options.map((o) => ({ id: o.id, body: o.body, isCorrect: o.isCorrect })),
      })),
    })),
  )

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: value }))
  }

  function save() {
    setError(null)
    setSaved(false)
    start(async () => {
      const result = await saveLessonAction(
        {
          id: lesson.id,
          sectionId: lesson.sectionId,
          title: form.title,
          kind: form.kind,
          /* Only the field this kind actually uses travels. Sending an article
             body on a video lesson would persist text nothing displays, and
             `lesson_is_ready` would then call the video ready on the strength
             of content the player never shows. */
          body: form.kind === 'article' ? form.body : null,
          storagePath: form.kind === 'video' ? form.storagePath : null,
          durationSeconds: form.kind === 'video' ? form.durationSeconds : null,
          isPreview: form.isPreview,
        },
        lesson.productId,
      )
      if (!result.ok) return setError(result.message)

      /* Then every quiz, in order. Sequential rather than parallel: a quiz has
         to exist before its questions can reference it, and the second call
         needs the id the first returns. */
      for (const quiz of quizzes) {
        const saveResult = await saveQuizAction(
          {
            id: quiz.id,
            lessonId: lesson.id,
            title: quiz.title,
            atSeconds: form.kind === 'video' ? quiz.atSeconds : null,
            passPercent: quiz.passPercent,
          },
          lesson.productId,
        )
        if (!saveResult.ok) return setError(saveResult.message)

        for (const [index, question] of quiz.questions.entries()) {
          const questionResult = await saveQuestionAction(
            {
              id: question.id,
              quizId: saveResult.data.id,
              prompt: question.prompt,
              position: index,
              options: question.options.map((o) => ({ body: o.body, isCorrect: o.isCorrect })),
            },
            lesson.productId,
          )
          if (!questionResult.ok) return setError(questionResult.message)
        }
      }

      setSaved(true)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-4 py-3 text-[0.8125rem] text-danger-700"
        >
          {error}
        </p>
      )}

      {/* What is still missing, in the same words the catalogue uses. Shown
          from the SERVER's last read, so it reflects what is actually stored
          rather than what is currently typed. */}
      {detail.problem ? (
        <p className="flex items-center gap-2 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 px-4 py-3 text-[0.8125rem] text-warning-600">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          {detail.problem}
        </p>
      ) : (
        <p className="flex items-center gap-2 rounded-(--radius-card) border border-success-500/25 bg-success-50 px-4 py-3 text-[0.8125rem] text-success-700">
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
          This lesson is complete.
        </p>
      )}

      <FormSection title="The lesson">
        <div className="space-y-4">
          <Field label="Title">
            <input
              className={inputClass()}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>

          <FieldSet
            label="Kind"
            hint="Changing this keeps the lesson but clears content the new kind does not use."
          >
            <Segmented
              value={form.kind}
              label="Kind"
              onChange={(v) => set('kind', v)}
              options={[
                { value: 'video', label: 'Video' },
                { value: 'article', label: 'Article' },
                { value: 'pdf', label: 'Reading' },
                { value: 'quiz', label: 'Quiz' },
              ]}
            />
          </FieldSet>

          <SwitchRow
            title="Free preview"
            description="Anyone can open it without buying — and nothing in it counts towards activation."
            checked={form.isPreview}
            onChange={(v) => set('isPreview', v)}
          />
        </div>
      </FormSection>

      {form.kind === 'video' && (
        <FormSection
          title="The video"
          description="Uploaded to the private bucket. Learners only ever get a 15-minute signed link, never the file."
        >
          <LessonMedia
            productId={lesson.productId}
            path={form.storagePath}
            durationSeconds={form.durationSeconds}
            onChange={(patch) => {
              setSaved(false)
              setForm((f) => ({ ...f, ...patch }))
            }}
          />
        </FormSection>
      )}

      {form.kind === 'article' && (
        <FormSection
          title="The text"
          description="Read in the app. There is no column anywhere that could hold a whole PDF, so nothing here can later be served as a file."
        >
          <textarea
            rows={16}
            value={form.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder={'Write the lesson here.\n\nA blank line starts a new paragraph.'}
            className="w-full resize-y rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.9375rem] leading-relaxed text-ink-900 pointer-coarse:text-base"
          />
          <p className="mt-1.5 text-[0.75rem] text-ink-400">
            {form.body.trim() ? `${form.body.trim().split(/\s+/).length} words` : 'Empty'}
          </p>
        </FormSection>
      )}

      {form.kind === 'pdf' && (
        <FormSection title="Resources">
          <p className="text-[0.8125rem] text-ink-500">
            {(detail.resources ?? []).length === 0
              ? 'No files attached yet. A reading lesson needs at least one before it can be published.'
              : `${detail.resources!.length} file${detail.resources!.length === 1 ? '' : 's'} attached.`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {(detail.resources ?? []).map((r) => (
              <li key={r.id} className="text-[0.8125rem] text-ink-700">
                {r.title}
              </li>
            ))}
          </ul>
        </FormSection>
      )}

      <FormSection
        title={form.kind === 'video' ? 'Checkpoints' : 'Quiz'}
        description={
          form.kind === 'video'
            ? 'A checkpoint pauses the video at a moment you choose and will not let the learner past until they answer. Every one has to be passed before the lesson counts.'
            : 'Marked on the server — the answer key never reaches the browser.'
        }
        action={
          /* A non-video lesson gets exactly one quiz: on a quiz lesson the quiz
             IS the lesson, and on an article a second one would have nothing to
             attach to. Only video can carry several, because each is pinned to
             a different second. */
          (form.kind === 'video' || quizzes.length === 0) && (
            <button
              type="button"
              onClick={() =>
                setQuizzes((qs) => [
                  ...qs,
                  {
                    title: form.kind === 'video' ? 'Quick check' : 'Section quiz',
                    atSeconds: null,
                    passPercent: 70,
                    questions: [
                      {
                        prompt: '',
                        options: [
                          { body: '', isCorrect: true },
                          { body: '', isCorrect: false },
                        ],
                      },
                    ],
                  },
                ])
              }
              className="inline-flex items-center gap-1.5 rounded-(--radius-input) border border-ink-200 px-3 py-1.5 text-[0.8125rem] font-semibold text-ink-800 transition-colors hover:border-ink-300"
            >
              <Plus aria-hidden className="size-4" />
              Add {form.kind === 'video' ? 'a checkpoint' : 'the quiz'}
            </button>
          )
        }
      >
        {quizzes.length === 0 ? (
          <p className="text-[0.8125rem] text-ink-500">
            {form.kind === 'quiz'
              ? 'A quiz lesson needs a quiz before it can be published.'
              : 'None yet.'}
          </p>
        ) : (
          <div className="space-y-3">
            {quizzes.map((quiz, qi) => (
              <QuizEditor
                key={quiz.id ?? qi}
                quiz={quiz}
                lessonKind={form.kind}
                disabled={pending}
                onChange={(next) =>
                  setQuizzes((qs) => qs.map((q, i) => (i === qi ? next : q)))
                }
                onDelete={() => {
                  const drop = () => setQuizzes((qs) => qs.filter((_, i) => i !== qi))
                  /* An unsaved quiz has no id and only exists in this form, so
                     it disappears without a round trip or a confirmation. */
                  if (!quiz.id) return drop()
                  if (!confirm(`Delete "${quiz.title}" and its questions?`)) return
                  start(async () => {
                    const result = await deleteQuizAction(quiz.id!, lesson.productId)
                    if (!result.ok) return setError(result.message)
                    drop()
                    router.refresh()
                  })
                }}
              />
            ))}
          </div>
        )}
      </FormSection>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save the lesson'}
        </button>
        {saved && !pending && (
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-success-700">
            <CheckCircle2 aria-hidden className="size-4" />
            Saved
          </span>
        )}
      </div>
    </div>
  )
}
