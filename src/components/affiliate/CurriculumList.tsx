import { CheckCircle2, CirclePlay, FileText, HelpCircle, Lock } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import { clock, remaining, type LessonKind, type Section } from '@/lib/market/course'
import { cn } from '@/lib/cn'

/**
 * The lesson list, per IMG_0582.
 *
 * ── EVERY ROW ANSWERS THREE QUESTIONS ──
 *
 * What kind of thing is this, how long will it take, and have I done it. The
 * reference gets this exactly right and it is worth copying precisely: a
 * numbered row, a type-and-duration line under the title, and a completion mark
 * that is a filled tick rather than a checkbox — you do not tick these, they
 * tick themselves.
 *
 * ── THE CURRENT LESSON IS TINTED, NOT JUST BOLD ──
 *
 * Also from the reference. On a list of twenty rows a weight change is easy to
 * lose; a tinted row is findable after scrolling away and back, which is what
 * somebody returning to a half-finished course actually does.
 *
 * ── LOCKED ROWS ARE STILL LISTED ──
 *
 * Somebody who has not bought the course sees the whole curriculum with a
 * padlock on the paid rows. Hiding them would hide what is being sold; a title
 * is not the content, and this list is the strongest argument the product page
 * has.
 */

const ICON: Record<LessonKind, typeof CirclePlay> = {
  video: CirclePlay,
  article: FileText,
  pdf: FileText,
  quiz: HelpCircle,
}

export async function CurriculumList({
  sections,
  slug,
  currentLessonId,
  entitled,
}: {
  sections: Section[]
  slug: string
  currentLessonId?: string | null
  /** False for a preview visitor: paid rows render locked and unlinked. */
  entitled: boolean
}) {
  const t = await getTranslations('affiliate.course')

  /*
    Numbered continuously across sections, like the reference — the count a
    learner cares about is "lecture 14 of 30", not "the third one in section
    two".

    Computed into a map BEFORE the JSX rather than by incrementing a counter
    inside it. A running mutation during render is exactly what the React
    Compiler's immutability rule objects to, and it is right to: memoising a
    branch of that tree would give the same lesson a different number depending
    on what re-rendered.
  */
  const numbers = new Map<string, number>()
  let running = 0
  for (const section of sections) {
    for (const lesson of section.lessons) {
      running += 1
      numbers.set(lesson.lesson_id, running)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {sections.map((section, index) => (
        <section key={section.id}>
          <h3 className="text-[0.8125rem] font-semibold text-ink-500">
            {t('section', { n: index + 1 })} — {section.title}
          </h3>

          <ul className="mt-2 overflow-hidden rounded-(--radius-card) border border-ink-200">
            {section.lessons.map((lesson) => {
              const Icon = ICON[lesson.kind] ?? FileText
              const open = entitled || lesson.is_preview
              const current = lesson.lesson_id === currentLessonId
              /* What is LEFT of a part-watched lesson, falling back to how long
                 the whole thing is. Straight from the reference, which prints
                 "06:03 mins remaining" on the row you are on and the plain
                 length on every other — the two facts answer different
                 questions and only one of them is worth the space at a time. */
              const left = remaining(lesson)
              const length = left ?? clock(lesson.duration_seconds ?? 0)

              const body = (
                <>
                  <span
                    className={cn(
                      'w-6 shrink-0 text-center text-[0.8125rem] font-semibold tabular-nums',
                      current ? 'text-brand-700' : 'text-ink-400',
                    )}
                  >
                    {numbers.get(lesson.lesson_id)}
                  </span>

                  <span className="min-w-0 flex-1">
                    {/* ⚠️ `min-w-0` on THIS row too, not only on its parent.
                        A flex item's default `min-width: auto` refuses to
                        shrink below its content, so the truncate below it never
                        fired and a long lesson title pushed the whole page
                        wider than the viewport — which showed up as the dark
                        canvas stopping halfway across, because the wrapper
                        paints its own box and the document had grown past it.
                        The overflow chain has to be unbroken from the row down
                        to the element that truncates. */}
                    <span className="flex min-w-0 items-center gap-1.5">
                      {lesson.completed && (
                        <CheckCircle2
                          aria-hidden
                          className="size-4 shrink-0 text-success-600"
                          strokeWidth={2.5}
                        />
                      )}
                      <span
                        className={cn(
                          'truncate text-[0.875rem]',
                          current ? 'font-semibold text-ink-900' : 'text-ink-800',
                        )}
                      >
                        {lesson.lesson_title}
                      </span>
                    </span>

                    {/* Kind and duration, in the reference's own phrasing:
                        "Video - 06:03 mins". The kind is spelled out rather
                        than left to the icon, because the icon is 16px and the
                        difference between an article and a PDF matters to
                        somebody deciding whether they have time for it. */}
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.75rem] text-ink-500">
                      <span>{t(`kind.${lesson.kind}`)}</span>
                      {length && (
                        <span className={cn(left && 'font-medium text-brand-700')}>
                          · {left ? t('remaining', { time: length }) : t('mins', { time: length })}
                        </span>
                      )}
                      {lesson.resource_count > 0 && (
                        <span>· {t('resourceCount', { n: lesson.resource_count })}</span>
                      )}
                      {lesson.quiz_count > 0 && <span>· {t('checkpoints', { n: lesson.quiz_count })}</span>}
                      {!entitled && lesson.is_preview && (
                        <span className="rounded-full bg-success-500/15 px-1.5 py-0.5 font-medium text-success-600">
                          {t('preview')}
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="shrink-0 text-ink-400">
                    {open ? (
                      <Icon aria-hidden className="size-4.5" />
                    ) : (
                      <Lock aria-hidden className="size-4" />
                    )}
                  </span>
                </>
              )

              const rowClass = cn(
                'flex w-full items-start gap-3 border-b border-ink-200 px-3.5 py-3 text-left last:border-b-0',
                current && 'bg-brand-50',
                open && !current && 'transition-colors hover:bg-ink-50',
                !open && 'opacity-60',
              )

              return (
                <li key={lesson.lesson_id}>
                  {open ? (
                    <Link
                      href={{ pathname: `/learn/${slug}`, query: { lesson: lesson.lesson_id } }}
                      aria-current={current ? 'true' : undefined}
                      /* ⚠️ NOT PREFETCHED, and a long course is why. Next
                         prefetches every link in the viewport, so a forty-row
                         curriculum fires forty RSC requests for the one row
                         that gets tapped — measured here as eleven requests
                         twice over on a nine-lesson course, and a 2.5s wait
                         behind them for the tap that was actually made. On a
                         Ghanaian phone plan that is somebody's data spent on
                         lessons they did not open. Next and Previous keep
                         their prefetch: those two are the ones about to be
                         used. */
                      prefetch={false}
                      className={rowClass}
                    >
                      {body}
                    </Link>
                  ) : (
                    /* Not a link and not focusable. A locked row that still
                       navigates is the version of this that fails an audit. */
                    <div aria-disabled="true" className={rowClass}>
                      {body}
                      <span className="sr-only">{t('locked')}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
