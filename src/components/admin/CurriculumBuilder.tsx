'use client'

import { useState, useTransition } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  HelpCircle,
  Plus,
  ScrollText,
  Trash2,
  PlayCircle,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/Badge'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { CurriculumRow, Section } from '@/lib/admin/catalogue-data'
import {
  deleteAction,
  reorderAction,
  saveLessonAction,
  saveSectionAction,
} from '@/app/[locale]/admin/(super)/catalogue/actions'

/**
 * The curriculum builder.
 *
 * ---------------------------------------------------------------------------
 * UP/DOWN BUTTONS, NOT DRAG AND DROP
 *
 * Drag is the obvious choice and the wrong one here. It needs a pointer that
 * can hover, it fights the page scroll on a touch device, and it is close to
 * unusable with a keyboard or a screen reader without building a whole
 * parallel keyboard interaction anyway. Two buttons are worse to look at and
 * better to use, and they work identically on every device the operator might
 * open this on.
 *
 * The reorder RPCs take an ordered array of ids, so a swap is expressed as the
 * whole new order rather than a pair of position writes that could half-apply.
 *
 * ---------------------------------------------------------------------------
 * DELETION SAYS WHO IT AFFECTS
 *
 * `learners_started` is on every row for one reason: deleting a lesson someone
 * is part-way through destroys their progress, and it also moves the
 * denominator of `training_completion_percent` — which can push an affiliate
 * back below the activation threshold. Activation itself only ever flips ON,
 * so they stay active, but their progress bar jumps backwards and they will
 * ask why.
 *
 * So a lesson nobody has opened deletes quietly, and one with learners in it
 * says how many before it will.
 */

const KIND_ICON: Record<string, LucideIcon> = {
  video: PlayCircle,
  article: ScrollText,
  pdf: FileText,
  quiz: HelpCircle,
}

const KIND_LABEL: Record<string, string> = {
  video: 'Video',
  article: 'Article',
  pdf: 'Reading',
  quiz: 'Quiz',
}

export function CurriculumBuilder({
  productId,
  sections,
}: {
  productId: string
  sections: Section[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [newSection, setNewSection] = useState('')

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null)
    start(async () => {
      const result = await fn()
      if (!result.ok) return setError(result.message ?? 'That did not work.')
      router.refresh()
    })
  }

  function move(list: { id: string }[], index: number, by: -1 | 1) {
    const next = [...list]
    const target = index + by
    if (target < 0 || target >= next.length) return null
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    return next.map((x) => x.id)
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-4 py-3 text-[0.8125rem] text-danger-700"
        >
          {error}
        </p>
      )}

      {sections.length === 0 && (
        <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-10 text-center text-[0.8125rem] text-ink-400">
          No sections yet. A course needs at least one section with at least one lesson in it
          before it can go on sale.
        </p>
      )}

      {sections.map((section, si) => (
        <section
          key={section.id}
          className="overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface"
        >
          <header className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2.5">
            <span className="text-[0.6875rem] font-medium tabular-nums text-ink-400">
              {si + 1}
            </span>
            <h2 className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-ink-900">
              {section.title}
            </h2>

            {section.lessons.length === 0 && (
              /* Migration 133 makes this a publish blocker — an empty section
                 renders in the player as a header with nothing under it, which
                 reads as a loading failure. Flagged here so it is fixed while
                 the operator is already looking at it. */
              <Badge tone="warning" className="shrink-0">
                Empty
              </Badge>
            )}

            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                label="Move section up"
                Icon={ChevronUp}
                disabled={pending || si === 0}
                onClick={() => {
                  const ids = move(sections, si, -1)
                  if (ids) run(() => reorderAction('sections', productId, ids, productId))
                }}
              />
              <IconButton
                label="Move section down"
                Icon={ChevronDown}
                disabled={pending || si === sections.length - 1}
                onClick={() => {
                  const ids = move(sections, si, 1)
                  if (ids) run(() => reorderAction('sections', productId, ids, productId))
                }}
              />
              <IconButton
                label="Delete section"
                Icon={Trash2}
                danger
                disabled={pending}
                onClick={() => {
                  const count = section.lessons.length
                  const message =
                    count === 0
                      ? `Delete "${section.title}"?`
                      : `Delete "${section.title}" and the ${count} lesson${count === 1 ? '' : 's'} in it? This cannot be undone.`
                  if (confirm(message)) {
                    run(() => deleteAction('section', section.id, productId))
                  }
                }}
              />
            </div>
          </header>

          <ul className="divide-y divide-ink-200">
            {section.lessons.map((lesson, li) => (
              <LessonRow
                key={lesson.lesson_id}
                lesson={lesson}
                productId={productId}
                pending={pending}
                canUp={li > 0}
                canDown={li < section.lessons.length - 1}
                onMove={(by) => {
                  const ids = move(
                    section.lessons.map((l) => ({ id: l.lesson_id! })),
                    li,
                    by,
                  )
                  if (ids) run(() => reorderAction('lessons', section.id, ids, productId))
                }}
                onDelete={() => {
                  const started = lesson.learners_started
                  const message =
                    started === 0
                      ? `Delete "${lesson.lesson_title}"?`
                      : `${started} learner${started === 1 ? ' has' : 's have'} already started "${lesson.lesson_title}". Deleting it destroys their progress and shortens the course. Continue?`
                  if (confirm(message)) {
                    run(() => deleteAction('lesson', lesson.lesson_id!, productId))
                  }
                }}
              />
            ))}
          </ul>

          {adding === section.id ? (
            <NewLesson
              sectionId={section.id}
              position={section.lessons.length}
              pending={pending}
              onCancel={() => setAdding(null)}
              onSave={(draft) =>
                run(async () => {
                  const result = await saveLessonAction(draft, productId)
                  if (result.ok) setAdding(null)
                  return result
                })
              }
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(section.id)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-[0.8125rem] font-medium text-brand-700 transition-colors hover:bg-ink-50"
            >
              <Plus aria-hidden className="size-4" />
              Add a lesson
            </button>
          )}
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.875rem] text-ink-900 pointer-coarse:text-base"
          placeholder="New section title"
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
        />
        <button
          type="button"
          disabled={pending || !newSection.trim()}
          onClick={() =>
            run(async () => {
              const result = await saveSectionAction({
                productId,
                title: newSection,
                position: sections.length,
              })
              if (result.ok) setNewSection('')
              return result
            })
          }
          className="rounded-(--radius-input) bg-brand-600 px-4 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          Add section
        </button>
      </div>
    </div>
  )
}

function LessonRow({
  lesson,
  productId,
  pending,
  canUp,
  canDown,
  onMove,
  onDelete,
}: {
  lesson: CurriculumRow
  productId: string
  pending: boolean
  canUp: boolean
  canDown: boolean
  onMove: (by: -1 | 1) => void
  onDelete: () => void
}) {
  const Icon = KIND_ICON[lesson.kind ?? 'video'] ?? PlayCircle

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Icon aria-hidden className="size-4 shrink-0 text-ink-400" />

      <Link
        href={`/admin/catalogue/${productId}/curriculum/${lesson.lesson_id}`}
        className="min-w-0 flex-1"
      >
        <span className="block truncate text-[0.875rem] font-medium text-ink-900">
          {lesson.lesson_title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-ink-500">
          <span>{KIND_LABEL[lesson.kind ?? 'video']}</span>
          {lesson.quiz_count > 0 && (
            <span>
              · {lesson.question_count} question{lesson.question_count === 1 ? '' : 's'}
            </span>
          )}
          {lesson.is_preview && <span>· Preview</span>}
          {/* Not a vanity metric — it is the warning that a delete here is
              destructive, shown before the operator reaches for the bin. */}
          {lesson.learners_started > 0 && (
            <span>· {lesson.learners_started} started</span>
          )}
        </span>
      </Link>

      {lesson.problem && (
        <span
          className="hidden shrink-0 items-center gap-1 text-[0.75rem] font-medium text-warning-600 sm:inline-flex"
          title={lesson.problem}
        >
          <AlertTriangle aria-hidden className="size-3.5" />
          <span className="max-w-[22ch] truncate">{lesson.problem}</span>
        </span>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label="Move up" Icon={ChevronUp} disabled={pending || !canUp} onClick={() => onMove(-1)} />
        <IconButton label="Move down" Icon={ChevronDown} disabled={pending || !canDown} onClick={() => onMove(1)} />
        <IconButton label="Delete lesson" Icon={Trash2} danger disabled={pending} onClick={onDelete} />
      </div>
    </li>
  )
}

function NewLesson({
  sectionId,
  position,
  pending,
  onCancel,
  onSave,
}: {
  sectionId: string
  position: number
  pending: boolean
  onCancel: () => void
  onSave: (draft: {
    sectionId: string
    title: string
    kind: 'video' | 'article' | 'pdf' | 'quiz'
    position: number
  }) => void
}) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'video' | 'article' | 'pdf' | 'quiz'>('video')

  return (
    <div className="border-t border-ink-200 bg-ink-50 px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          autoFocus
          className="min-w-0 flex-1 rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.875rem] text-ink-900 pointer-coarse:text-base"
          placeholder="Lesson title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          className="rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.875rem] text-ink-900 pointer-coarse:text-base"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="video">Video</option>
          <option value="article">Article</option>
          <option value="pdf">Reading</option>
          <option value="quiz">Quiz</option>
        </select>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={pending || !title.trim()}
          onClick={() => onSave({ sectionId, title, kind, position })}
          className="rounded-(--radius-input) bg-brand-600 px-3.5 py-1.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[0.8125rem] font-medium text-ink-500 hover:text-ink-800"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-[0.75rem] text-ink-500">
        The content — a video file, the article text, a quiz — is added on the lesson itself.
      </p>
    </div>
  )
}

function IconButton({
  label,
  Icon,
  onClick,
  disabled,
  danger,
}: {
  label: string
  Icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // 32px, which is under the 44px touch guidance — acceptable only
        // because this is an admin screen the operator uses on a laptop, and
        // three of these in a row at 44px would take 132px off every lesson
        // title. The phone layout keeps them because reordering on a phone is
        // rare but must not be impossible.
        'grid size-8 place-items-center rounded-(--radius-input) transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-30',
        danger
          ? 'text-ink-400 hover:bg-danger-50 hover:text-danger-600'
          : 'text-ink-400 hover:bg-ink-100 hover:text-ink-800',
      )}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  )
}
