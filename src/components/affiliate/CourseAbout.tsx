import { Award, CalendarClock, Check, Clock, FileQuestion, PlayCircle } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { courseLength } from '@/lib/market/covers'

/**
 * What this course is, for the third tab.
 *
 * ── IT IS NOT THE SALES PAGE AGAIN ──
 *
 * The reference's "More" tab is Q&A, announcements and reviews, none of which
 * exist here. What is actually missing from a player once somebody is inside a
 * course is plainer: what it covers, how much of it there is, how long they
 * keep access, and whether finishing produces anything. A learner in week three
 * does not need the pitch, so the price and the buy button are not here — they
 * already own it.
 *
 * Every figure is summed from the curriculum rather than stored beside it, so
 * none of them can disagree with the lessons actually on the course.
 */
export async function CourseAbout({
  description,
  outcomes,
  lessons,
  quizzes,
  seconds,
  training,
}: {
  description: string | null
  outcomes: string[]
  lessons: number
  quizzes: number
  seconds: number
  /** Null on a vendor course: it is bought outright and does not expire, so
   *  the access and certificate rows are dropped rather than showing "n/a". */
  training: { validityDays: number; certificate: boolean } | null
}) {
  const t = await getTranslations('affiliate.course.about')
  const length = courseLength(seconds)

  const facts = [
    { key: 'lessons', Icon: PlayCircle, value: String(lessons) },
    length ? { key: 'length', Icon: Clock, value: length } : null,
    quizzes > 0 ? { key: 'quizzes', Icon: FileQuestion, value: String(quizzes) } : null,
    training
      ? {
          key: 'access',
          Icon: CalendarClock,
          value: t('accessValue', { days: training.validityDays }),
        }
      : null,
    training?.certificate
      ? { key: 'certificate', Icon: Award, value: t('certificateValue') }
      : null,
  ].filter((fact) => fact !== null)

  return (
    <div className="flex flex-col gap-4">
      {description && (
        <div className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4">
          <h3 className="text-[0.875rem] font-semibold text-ink-900">{t('heading')}</h3>
          <div className="mt-2 flex flex-col gap-2.5 text-[0.875rem] leading-relaxed text-ink-700">
            {description.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      )}

      {outcomes.length > 0 && (
        <div className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4">
          <h3 className="text-[0.875rem] font-semibold text-ink-900">{t('outcomes')}</h3>
          <ul className="mt-2.5 flex flex-col gap-2">
            {outcomes.map((outcome) => (
              <li key={outcome} className="flex items-start gap-2.5">
                <Check
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-success-600"
                  strokeWidth={2.5}
                />
                <span className="text-[0.875rem] leading-snug text-ink-700">{outcome}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface">
        {facts.map(({ key, Icon, value }) => (
          <div
            key={key}
            className="flex items-center gap-3 border-b border-ink-200 px-4 py-3 last:border-b-0"
          >
            <Icon aria-hidden className="size-4.5 shrink-0 text-ink-400" />
            <dt className="min-w-0 flex-1 text-[0.875rem] text-ink-600">{t(key)}</dt>
            <dd className="shrink-0 text-[0.875rem] font-semibold tabular-nums text-ink-900">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
