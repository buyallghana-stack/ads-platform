import { TrendingDown, TrendingUp } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * The headline figure card from reference 1.
 *
 * Its shape is doing real work and is worth keeping exactly: a quiet label,
 * a comparison line ABOVE the number, then the number large, then the change.
 * Putting last month above this month is what stops the big number being read
 * without context — the reader meets the baseline before the headline.
 *
 * `positiveIsGood` exists because this dashboard shows both. Deposits rising
 * is good and withdrawals rising is not, and colouring both green because the
 * arrow points up would quietly congratulate the operator on paying out more.
 */
export function MetricCard({
  label,
  value,
  comparison,
  changePct,
  positiveIsGood = true,
  icon,
  footer,
  className,
}: {
  label: string
  value: string
  /** The "€172,650.00 previous month" line from the reference. */
  comparison?: string
  changePct?: number
  positiveIsGood?: boolean
  icon?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const rising = (changePct ?? 0) >= 0
  const good = rising === positiveIsGood
  const Arrow = rising ? TrendingUp : TrendingDown

  return (
    <div
      className={cn(
        'flex flex-col rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5',
        'shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="text-ink-400 [&>svg]:size-4">{icon}</span>}
        <p className="truncate text-[0.8125rem] font-medium text-ink-700">{label}</p>
      </div>

      {comparison && <p className="mt-1 truncate text-[0.75rem] text-ink-400">{comparison}</p>}

      <p className="mt-2 text-[1.5rem] leading-none font-bold tracking-[-0.02em] text-ink-900 tabular-nums sm:text-[1.75rem]">
        {value}
      </p>

      {changePct !== undefined && (
        <p
          className={cn(
            'mt-2.5 flex items-center gap-1 text-[0.75rem] font-medium',
            good ? 'text-success-700' : 'text-danger-700',
          )}
        >
          <Arrow aria-hidden className="size-3.5" />
          {Math.abs(changePct).toFixed(1)}%
        </p>
      )}

      {footer && <div className="mt-2.5 text-[0.75rem] text-ink-500">{footer}</div>}
    </div>
  )
}
