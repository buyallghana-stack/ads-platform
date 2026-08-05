import { GraduationCap } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { TrainingProgress } from '@/lib/market/data'

/**
 * How much course is left before the affiliate account switches on.
 *
 * This is the PRIMARY content of the pending dashboard, not a card beside the
 * statistics — DESIGN.md call 6. Someone who bought training an hour ago has
 * no clicks, no conversions and no earnings, and showing them a grid of eight
 * zeroes teaches them nothing while making them feel behind. The one number
 * that matters to them is how much course is left.
 *
 * The threshold is drawn ON the bar rather than described beside it. "Activate
 * at 50%" as a sentence is a fact you have to hold in your head while looking
 * at a bar; a marker at the halfway point is the same fact you can simply see.
 *
 * Once past the threshold the marker stays, because completing the whole course
 * still earns a certificate and the bar has further to run. The label changes
 * to say what the rest is for — otherwise a bar that keeps going after you have
 * got what you wanted reads as broken.
 */
export function ProgressToActivation({
  course,
  labels,
}: {
  course: TrainingProgress
  labels: {
    /** e.g. "{n}% to go before you can start promoting" */
    toGo: string
    /** e.g. "Unlocked. Finish the course for your certificate." */
    unlocked: string
    /** e.g. "Course complete" */
    complete: string
    threshold: string
  }
}) {
  const reached = course.percent >= course.threshold
  const done = course.percent >= 100

  return (
    <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-jade-50 text-jade-700"
        >
          <GraduationCap className="size-4.5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-900">{course.title}</p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-600">
            {done ? labels.complete : reached ? labels.unlocked : labels.toGo}
          </p>
        </div>
        <p className="shrink-0 text-lg leading-none font-semibold tabular-nums text-ink-900">
          {course.percent}%
        </p>
      </div>

      {/* NOT `overflow-hidden`: the threshold tick has to sit ON the track and
          stay visible at the exact moment the fill reaches it, which is the
          one moment it matters. The fill gets its own rounding instead. */}
      <div className="relative mt-3.5 h-2">
        <div
          role="progressbar"
          aria-valuenow={course.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={course.title}
          className="h-full overflow-hidden rounded-full bg-ink-100"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              reached ? 'bg-jade-600' : 'bg-brand-600',
            )}
            style={{ width: `${Math.min(100, Math.max(0, course.percent))}%` }}
          />
        </div>

        {/* The tick. This is the whole idea: "activate at 50%" as a sentence is
            a fact you have to hold in your head while looking at a bar; a mark
            at the halfway point is the same fact you can simply see.
            Taller than the track so it reads as a gate rather than a segment. */}
        {!done && (
          <span
            aria-hidden
            className={cn(
              'absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
              reached ? 'bg-jade-700' : 'bg-ink-400',
            )}
            style={{ left: `${Math.min(100, Math.max(0, course.threshold))}%` }}
          />
        )}
      </div>

      {!done && (
        <div className="relative mt-1.5 h-4">
          <span
            className={cn(
              'absolute text-[0.6875rem] font-medium whitespace-nowrap text-ink-500',
              // Clamped so the caption cannot run off either edge when the
              // threshold sits near 0 or 100. Centred on the tick elsewhere.
              course.threshold <= 15
                ? 'left-0'
                : course.threshold >= 85
                  ? 'right-0'
                  : '-translate-x-1/2',
            )}
            style={
              course.threshold > 15 && course.threshold < 85
                ? { left: `${course.threshold}%` }
                : undefined
            }
          >
            {labels.threshold}
          </span>
        </div>
      )}
    </div>
  )
}
