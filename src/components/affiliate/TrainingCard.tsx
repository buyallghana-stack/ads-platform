import { Award, ChevronRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import type { TrainingProgress } from '@/lib/market/data'
import { cn } from '@/lib/cn'

/**
 * "Complete your training" — the progress card on the affiliate dashboard.
 *
 * ── IT IS NOT A NUDGE, IT IS A GATE ──
 *
 * An affiliate account does not switch on until the course reaches
 * `activation_threshold_percent`. Until then links can be copied and clicks can
 * be recorded, and none of it pays. So this card is not encouragement to finish
 * a course; it is the reason the rest of the dashboard reads zero, and it says
 * so in those terms before the threshold and in different terms after it.
 *
 * That is why the threshold is drawn as a MARK ON THE BAR rather than only
 * stated in the text. A percentage and a target in two separate sentences make
 * the reader do the subtraction; a notch on the track answers "how much more"
 * without any arithmetic, which is the whole question.
 *
 * Once past the threshold the card stops being a gate and becomes what the
 * reference shows: the remaining distance to the certificate. Same card, same
 * bar, different claim — because the same 60% means two different things
 * depending on which side of the threshold it is on.
 */
export async function TrainingCard({ course }: { course: TrainingProgress }) {
  const t = await getTranslations('affiliate.training')
  const active = course.percent >= course.threshold
  const done = course.percent >= 100

  return (
    <section
      aria-label={t('label')}
      className="relative isolate overflow-hidden rounded-(--radius-panel) border border-brand-600/30 bg-brand-50 px-5 py-5"
    >
      <div
        aria-hidden
        className="absolute -right-10 -top-16 -z-10 size-48 rounded-full bg-brand-600/15 blur-2xl"
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
            {done ? t('doneTitle') : active ? t('certificateTitle') : t('gateTitle')}
          </h2>
          <p className="mt-1 max-w-md text-[0.8125rem] leading-relaxed text-ink-600">
            {done
              ? t('doneBody', { title: course.title })
              : active
                ? /* What is LEFT, not what is done. "Finish the remaining 50%"
                     rendered from `percent` said the same number twice with
                     opposite meanings — the bar showed 50% complete and the
                     sentence read as 50% still to go, which happened to be
                     true at exactly one value and wrong everywhere else. */
                  t('certificateBody', { percent: 100 - course.percent })
                : t('gateBody', { percent: course.percent, threshold: course.threshold })}
          </p>
        </div>

        {/* The reference's medal. A badge is the right object here — it is what
            the course is FOR — but it is decorative, so it goes behind the text
            in the reading order and carries no label. */}
        <span
          aria-hidden
          className="hidden shrink-0 place-items-center rounded-2xl bg-brand-600/15 p-3 text-brand-700 ring-1 ring-brand-600/25 sm:grid"
        >
          <Award className="size-9" strokeWidth={1.5} />
        </span>
      </div>

      {/* Progress. The threshold notch is what turns two numbers into one
          picture — see the note above. */}
      <div className="mt-4">
        <div className="relative h-2 overflow-hidden rounded-full bg-ink-100">
          <div
            className={cn(
              'h-full rounded-full transition-[width]',
              active ? 'bg-success-500' : 'bg-brand-600',
            )}
            style={{ width: `${Math.min(Math.max(course.percent, 0), 100)}%` }}
          />
          {!active && course.threshold > 0 && course.threshold < 100 && (
            <span
              aria-hidden
              className="absolute inset-y-0 w-0.5 bg-ink-400"
              style={{ left: `${course.threshold}%` }}
            />
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[0.75rem] tabular-nums">
          <span className="font-semibold text-ink-900">{course.percent}%</span>
          {!active && <span className="text-ink-500">{t('unlocksAt', { n: course.threshold })}</span>}
        </div>
      </div>

      <Link
        href={`/learn/${course.slug}`}
        className={cn(
          'mt-4 inline-flex items-center gap-1.5 rounded-(--radius-input) bg-brand-600 px-4 py-2.5',
          'text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500',
        )}
      >
        {done ? t('review') : course.percent > 0 ? t('continue') : t('start')}
        <ChevronRight aria-hidden className="size-4" />
      </Link>
    </section>
  )
}
