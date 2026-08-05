'use client'

import { Check, FileText, HelpCircle, Lock, type LucideIcon, PlayCircle, ScrollText } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { CurriculumRow, LessonKind, Section } from '@/lib/market/course'

/**
 * The curriculum list.
 *
 * Row anatomy is read off the operator's Udemy screenshots, because those
 * decisions are load-bearing and were arrived at over many iterations by
 * people with far more data than we have:
 *
 *   number · title · one metadata line naming the kind IN WORDS
 *
 * Naming the kind in words is what lets four content kinds coexist without
 * four icons nobody can tell apart. The icon is there as well, but it is
 * support, not the message.
 *
 * Three deliberate departures from the reference (DESIGN.md call 3):
 *
 * 1. NO DOWNLOAD CONTROL. Content is read in app (E32) — but the design point
 *    stands on its own: in the reference the download circle is the heaviest
 *    element on every row, so the least important action is the loudest thing
 *    on the screen. Our right edge carries STATE instead — a completion check,
 *    or a lock.
 *
 * 2. ONE NUMBERING SEQUENCE. The reference interleaves lectures numbered
 *    14, 15, 16 with challenges numbered 1, 2, and the result is genuinely
 *    confusing. Lessons here are numbered straight through their section.
 *
 * 3. STRONGER METADATA CONTRAST. Small grey-on-white is a poor bet on a cheap
 *    handset in Ghanaian daylight, which is the actual device and the actual
 *    lighting.
 *
 * The active row takes the reference's best idea: its metadata line changes
 * MEANING, from total length to what is left. Once you have started something,
 * how long it is stops being the useful fact.
 */

const KIND_ICON: Record<LessonKind, LucideIcon> = {
  video: PlayCircle,
  article: ScrollText,
  pdf: FileText,
  quiz: HelpCircle,
}

function minutes(seconds: number | null): number {
  return Math.max(1, Math.round((seconds ?? 0) / 60))
}

function LessonRow({
  lesson,
  index,
  active,
  entitled,
  href,
}: {
  lesson: CurriculumRow
  index: number
  active: boolean
  /** Whether the viewer owns the course. Decided by the page, which is the
   *  only place that knows — the curriculum rows carry no entitlement. */
  entitled: boolean
  href: string
}) {
  const t = useTranslations('market.course')
  const Icon = KIND_ICON[lesson.kind]

  /*
    Locked = not owned and not a preview. The row still RENDERS when locked:
    hiding it would make the course look shorter than it is, and somebody
    deciding whether to buy is entitled to see what they would be getting.
    It just does not navigate.
  */
  const locked = !entitled && !lesson.is_preview

  const meta =
    lesson.kind === 'quiz'
      ? t('meta.quiz', { n: lesson.quiz_count })
      : lesson.kind === 'video'
        ? active && !lesson.completed && lesson.seconds_watched > 0
          ? t('meta.remaining', {
              n: minutes((lesson.duration_seconds ?? 0) - lesson.seconds_watched),
            })
          : t('meta.video', { n: minutes(lesson.duration_seconds) })
        : lesson.kind === 'pdf'
          ? t('meta.pdf', { n: lesson.resource_count })
          : t('meta.article', { n: Math.max(1, Math.round((lesson.word_count ?? 0) / 200)) })

  /* A locked row is a <div>, not a disabled <Link>. A link that goes nowhere
     is still focusable and still announces itself as a link to a screen
     reader, which is a worse lie than simply not being one. */
  const Row = locked ? 'div' : Link
  const rowProps = locked ? {} : { href, 'aria-current': active ? ('true' as const) : undefined }

  return (
    <li>
      <Row
        {...(rowProps as { href: string })}
        className={cn(
          'flex items-start gap-3 px-4 py-3 transition-colors',
          locked ? 'cursor-default opacity-60' : active ? 'bg-jade-50' : 'hover:bg-ink-50',
        )}
      >
        {/* The number column doubles as the completion column: a check
            REPLACES the number once done, so progress reads straight down the
            left edge without adding a fifth element to the row. */}
        <span className="mt-0.5 grid w-5 shrink-0 place-items-center">
          {lesson.completed ? (
            <Check aria-label={t('done')} className="size-4 text-jade-600" strokeWidth={2.6} />
          ) : (
            <span
              className={cn(
                'text-[0.8125rem] tabular-nums',
                active ? 'font-semibold text-jade-700' : 'text-ink-400',
              )}
            >
              {index}
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-[0.9375rem] leading-snug',
              active ? 'font-semibold text-jade-700' : 'font-medium text-ink-900',
            )}
          >
            {lesson.lesson_title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] text-ink-600">
            <Icon aria-hidden className="size-3.5 shrink-0" />
            {meta}
          </span>
        </span>

        {locked && <Lock aria-label={t('locked')} className="mt-1 size-4 shrink-0 text-ink-400" />}
      </Row>
    </li>
  )
}

export function CurriculumList({
  sections,
  activeLessonId,
  entitled,
  slug,
  courseTitle,
  className,
}: {
  sections: Section[]
  activeLessonId?: string
  entitled: boolean
  slug: string
  /** Shown in the rail header. Omitted on a phone, where the page already
   *  carries the course context above the list. */
  courseTitle?: string
  className?: string
}) {
  const t = useTranslations('market.course')

  const lessons = sections.flatMap((s) => s.lessons)
  const done = lessons.filter((l) => l.completed).length
  const percent = lessons.length ? Math.floor((done / lessons.length) * 100) : 0

  return (
    <div className={className}>
      {/* Overall progress, at the top of the rail. Section-by-section
          completion answers "what is left in THIS part"; this answers "how far
          through am I", which is the question somebody returning after a few
          days is actually asking. */}
      {courseTitle && (
        <div className="border-b border-ink-200 px-4 py-3.5">
          <p className="truncate text-sm font-semibold text-ink-900">{courseTitle}</p>
          <div className="mt-2 flex items-center gap-2.5">
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={courseTitle}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100"
            >
              <div
                className="h-full rounded-full bg-jade-600 transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="shrink-0 text-[0.75rem] font-medium tabular-nums text-ink-600">
              {t('progress', { done, total: lessons.length })}
            </span>
          </div>
        </div>
      )}
      {sections.map((section, si) => (
        <section key={section.id}>
          {/* Section headers are plain rows, not accordions. On a phone the
              reference keeps the list flat and continuous, and collapsing
              hides exactly the structure a learner is scrolling to find. */}
          <h2 className="sticky top-0 z-10 border-y border-ink-200 bg-ink-50 px-4 py-2 text-[0.8125rem] font-semibold text-ink-700">
            {t('section', { n: si + 1, title: section.title })}
          </h2>
          <ul className="divide-y divide-ink-200">
            {section.lessons.map((lesson, li) => (
              <LessonRow
                key={lesson.lesson_id}
                lesson={lesson}
                index={li + 1}
                active={lesson.lesson_id === activeLessonId}
                entitled={entitled}
                href={`/learn/${slug}/${lesson.lesson_id}`}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
