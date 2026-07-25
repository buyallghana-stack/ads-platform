import { TrendingDown, TrendingUp } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * The headline figure card.
 *
 * Its shape is doing real work and is worth keeping exactly: a quiet label,
 * a comparison line ABOVE the number, then the number large, then the change.
 * Putting last month above this month is what stops the big number being read
 * without context — the reader meets the baseline before the headline.
 *
 * FLATTENED 2026-07-25. It used to carry a drop shadow and a leading icon, and
 * eight of them tiled across the overview read as eight objects floating over
 * the page. One hairline border and no shadow puts the card back where it
 * belongs — a division of the surface rather than a thing sitting on it — and
 * lets the numbers, which are the only part anybody came for, be the loudest
 * thing on the screen. The icon went for the same reason: it labelled nothing
 * the text had not already said.
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
  footer,
  className,
}: {
  label: string
  value: string
  /** The "GHS 172,650.00 previous month" line. */
  comparison?: string
  changePct?: number
  positiveIsGood?: boolean
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
        className,
      )}
    >
      <p className="truncate text-[0.8125rem] font-medium text-ink-600">{label}</p>

      {/* Clamped rather than truncated: "GHS 21,750 plans · GHS 26,500
          advertisers" is two facts, and cutting it at one and a half was
          losing the half that made the split worth showing. */}
      {comparison && (
        <p className="mt-0.5 line-clamp-2 text-[0.6875rem] leading-snug text-ink-400">
          {comparison}
        </p>
      )}

      <p className="mt-2.5 text-[1.5rem] leading-none font-semibold tracking-[-0.02em] text-ink-900 tabular-nums sm:text-[1.75rem]">
        {value}
      </p>

      {changePct !== undefined && (
        <p
          className={cn(
            'mt-2.5 inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5',
            'text-[0.6875rem] font-semibold',
            good ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700',
          )}
        >
          <Arrow aria-hidden className="size-3" />
          {Math.abs(changePct).toFixed(1)}%
        </p>
      )}

      {footer && <div className="mt-2.5 text-[0.75rem] text-ink-500">{footer}</div>}
    </div>
  )
}
