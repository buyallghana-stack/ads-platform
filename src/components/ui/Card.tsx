import { cn } from '@/lib/cn'

/**
 * Card.
 *
 * The primitive every dashboard panel is built from, so the details here get
 * repeated hundreds of times and are worth being exact about.
 *
 * What defines the look:
 *   - A 1px border does the containing, not a shadow. Shadow-heavy cards read
 *     as floating and stack badly when there are twelve of them on a page.
 *     One barely-there shadow lifts it off the background; the border draws it.
 *   - Sections are divided by their own 1px borders rather than by padding
 *     alone, so a header stays a header when the body scrolls.
 *   - The footer sits on a faintly tinted background. That single tone is what
 *     makes a card read as having a base rather than just stopping.
 *   - Small radius, matching the controls inside it.
 *
 * Compose as: Card > CardHeader + CardBody + CardFooter. Any may be omitted.
 */

export function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<'div'> & {
  /** Adds hover affordance. Only for cards that are genuinely clickable. */
  interactive?: boolean
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface',
        'shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]',
        interactive &&
          'transition-[border-color,box-shadow] duration-150 hover:border-ink-300 hover:shadow-[0_1px_3px_0_rgb(15_23_42/0.08)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Right-aligned control — a button, a menu, a badge. */
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-ink-200 px-4 py-3.5',
        className,
      )}
      {...props}
    >
      {(title || description) && (
        <div className="min-w-0">
          {title && (
            <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-ink-900">
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-500">{description}</p>
          )}
        </div>
      )}
      {children}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-4 py-4', className)} {...props} />
}

export function CardFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        // The tint is the point — it gives the card a base instead of an
        // abrupt end.
        'flex items-center justify-between gap-3 border-t border-ink-200 bg-ink-50 px-4 py-3',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Stat tile. The single most repeated shape on the dashboards — balance,
 * cedi value, ads remaining, pending redemptions — so it is a named
 * component rather than a pattern everyone re-derives slightly differently.
 */
export function StatCard({
  label,
  value,
  sublabel,
  icon,
  trend,
  className,
}: {
  label: string
  value: React.ReactNode
  sublabel?: React.ReactNode
  icon?: React.ReactNode
  trend?: { value: string; direction: 'up' | 'down' | 'flat' }
}& { className?: string }) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-medium text-ink-500">{label}</p>
          {/*
            Tabular figures so a value changing from 1,999 to 2,000 does not
            shift the layout — this sits next to a Realtime balance (§6.10).
          */}
          <p className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] tabular-nums text-ink-900">
            {value}
          </p>
          {sublabel && <p className="mt-1 text-[0.75rem] text-ink-400">{sublabel}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {icon && (
            <span className="grid size-8 place-items-center rounded-(--radius-input) border border-ink-200 bg-ink-50 text-ink-500 [&>svg]:size-4">
              {icon}
            </span>
          )}
          {trend && (
            <span
              className={cn(
                'text-[0.75rem] font-medium tabular-nums',
                trend.direction === 'up' && 'text-success-700',
                trend.direction === 'down' && 'text-danger-600',
                trend.direction === 'flat' && 'text-ink-400',
              )}
            >
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}{' '}
              {trend.value}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}
