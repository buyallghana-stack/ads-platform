import { cn } from '@/lib/cn'

/**
 * One figure on the affiliate dashboard.
 *
 * Two rules, both from DESIGN.md call 6:
 *
 * 1. A tile can be EMPTY rather than zero. "No clicks yet" and "0.0%" are
 *    different facts, and a grid of zeroes tells a new affiliate nothing while
 *    making them feel behind. Pass `value={null}` and it says so plainly.
 *
 * 2. `hint` is where the denominator goes. A raw click count with nothing to
 *    divide by does not tell somebody whether their promoting works, which is
 *    the only question they are asking.
 *
 * The figure is tabular-nums so a column of them lines up, and the label sits
 * ABOVE it — a number is what the eye lands on, and it should not have to
 * travel back up to find out what it means.
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
  /** Shown when `value` is null. Say what is missing, not "0". */
  empty?: string
  /** `success` only for money actually earned. Never jade — jade is the mode,
   *  not a status. */
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
        'rounded-(--radius-card) border border-ink-200 bg-surface px-3.5 py-3',
        className,
      )}
    >
      <p className="text-[0.75rem] font-medium text-ink-500">{label}</p>
      {value === null ? (
        <p className="mt-1 text-[0.9375rem] leading-tight font-medium text-ink-400">
          {empty ?? '—'}
        </p>
      ) : (
        <p
          className={cn(
            'mt-1 text-[1.375rem] leading-tight font-semibold tabular-nums tracking-[-0.02em]',
            TONE,
          )}
        >
          {value}
        </p>
      )}
      {hint && <p className="mt-1 text-[0.75rem] leading-snug text-ink-500">{hint}</p>}
    </div>
  )
}
