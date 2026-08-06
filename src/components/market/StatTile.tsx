import { cn } from '@/lib/cn'

/**
 * One figure on the affiliate dashboard.
 *
 * Two rules, both unchanged from the first build because both were right:
 *
 * 1. A tile can be EMPTY rather than zero. "No clicks yet" and "0.0%" are
 *    different facts, and a grid of zeroes tells a new affiliate nothing while
 *    making them feel behind.
 *
 * 2. `hint` is where the denominator goes. A raw click count with nothing to
 *    divide by does not answer the only question being asked.
 *
 * What changed is the rendering: bigger figure, rounded panel, warm surface —
 * the market skin rather than the ads dashboard's tighter slate grid.
 */
export function StatTile({
  label,
  value,
  hint,
  empty,
  tone = 'neutral',
  className,
}: {
  label: string
  /** `null` renders `empty` instead — see rule 1. */
  value: string | null
  hint?: string | null
  empty?: string
  /** `success` only for money actually earned. Never jade: jade is the
   *  business, not a status. */
  tone?: 'neutral' | 'success' | 'danger'
  className?: string
}) {
  const TONE = {
    neutral: 'text-ink-900',
    success: 'text-success-700',
    danger: 'text-danger-700',
  }[tone]

  return (
    <div
      className={cn(
        'rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5',
        className,
      )}
    >
      <p className="text-[0.75rem] font-medium text-ink-500">{label}</p>
      {value === null ? (
        <p className="mt-1.5 text-[1rem] leading-tight font-medium text-ink-400">{empty ?? '—'}</p>
      ) : (
        <p
          className={cn(
            'mt-1.5 text-[1.5rem] leading-none font-semibold tabular-nums tracking-[-0.03em]',
            TONE,
          )}
        >
          {value}
        </p>
      )}
      {hint && <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-500">{hint}</p>}
    </div>
  )
}
