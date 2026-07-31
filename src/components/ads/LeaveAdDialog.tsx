'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * "Leave this ad?" — the one control on an ad screen that throws work away.
 *
 * ONE COMPONENT FOR EVERY FORMAT, because the operator found the difference:
 * the X on a video or a survey stopped to show what leaving would cost, and
 * the X on an article silently dropped you back on the feed. Two surfaces
 * asking the same question in two different ways is how a product starts
 * feeling assembled rather than made, and the drift only ever gets wider — so
 * the chrome, the wording and the buttons live here, and each surface supplies
 * only the part that is genuinely its own: what it has to lose.
 *
 * WHY IT ASKS AT ALL. The X sits in the corner every "go back" instinct
 * reaches for, and leaving really does discard the server's clock — the ad
 * begins again. So it shows what would be lost, because "you will lose your
 * progress" means nothing until you see that it is four answers and two
 * minutes of watching.
 *
 * WHY IT SOMETIMES DOES NOT ASK. Nothing to lose means no dialog: a
 * confirmation that fires when you have done nothing is how people learn to
 * dismiss confirmations without reading them, and this one has to be read.
 * Each surface decides that for itself and simply does not render this.
 */
export function LeaveAdDialog({
  body,
  progress,
  note,
  onStay,
  onLeave,
}: {
  /** What leaving costs, in this format's terms. */
  body: string
  /** Where they are: the lines and bars that belong to this format. */
  progress: React.ReactNode
  /** The reassurance under the rule — that leaving is not a penalty. */
  note: string
  onStay: () => void
  onLeave: () => void
}) {
  const t = useTranslations('ads')

  return (
    /* z-50: above the header (40) and the result card (30 or 20 depending on
       the surface). This dialog IS the way out asking a question, so nothing
       may sit over it. */
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={t('leave.title')}
        className="w-full max-w-[24rem] rounded-(--radius-panel) bg-surface p-5 shadow-[0_16px_48px_-12px_rgb(15_23_42/0.5)]"
      >
        <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('leave.title')}</h2>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-500">{body}</p>

        {/* What is actually on the table. */}
        <div className="mt-3.5 rounded-(--radius-card) border border-ink-200 bg-ink-50/60 px-3.5 py-3">
          <p className="text-[0.6875rem] font-medium tracking-[0.04em] text-ink-400 uppercase">
            {t('leave.progress')}
          </p>

          {progress}

          {/* The reassurance that matters most: leaving is not a failed
              attempt. Without this line people stay in an ad they no longer
              want, because they think quitting is penalised. */}
          <p className="mt-2.5 border-t border-ink-200 pt-2.5 text-[0.75rem] leading-relaxed text-ink-500">
            {note}
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Button fullWidth onClick={onStay}>
            {t('leave.stay')}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={onLeave}
            className="text-danger-700 hover:bg-danger-50"
          >
            {t('leave.leave')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** A line of progress, in the dialog's own type. Exported so both surfaces
 *  describe themselves in the same voice rather than each inventing one. */
export function LeaveFact({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-[0.8125rem] font-medium text-ink-900 tabular-nums', className)}>
      {children}
    </p>
  )
}

/** How far through, as a bar. */
export function LeaveBar({ fraction }: { fraction: number }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-200">
      <span
        className="block h-full rounded-full bg-brand-600"
        style={{ width: `${Math.min(Math.max(fraction, 0) * 100, 100)}%` }}
      />
    </div>
  )
}
