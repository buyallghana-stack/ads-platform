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
 *
 * The icon chip takes a meaning-coded tone (see the accent tokens in
 * globals.css): colour identifies the stat's category at a glance, the way
 * every fintech home screen the operator's users know does it. Neutral grey
 * remains the default so nothing is forced to pick a colour.
 */

type StatTone = 'neutral' | 'brand' | 'success' | 'violet' | 'teal' | 'orange'

const STAT_CHIP: Record<StatTone, string> = {
  neutral: 'border-ink-200 bg-ink-50 text-ink-500',
  brand: 'border-brand-600/20 bg-brand-50 text-brand-600',
  success: 'border-success-500/25 bg-success-50 text-success-600',
  violet: 'border-violet-600/20 bg-violet-50 text-violet-600',
  teal: 'border-teal-500/25 bg-teal-50 text-teal-600',
  orange: 'border-orange-500/25 bg-orange-50 text-orange-600',
}

const STAT_BAR: Record<StatTone, string> = {
  neutral: 'bg-ink-400',
  brand: 'bg-brand-600',
  success: 'bg-success-600',
  violet: 'bg-violet-600',
  teal: 'bg-teal-600',
  orange: 'bg-orange-600',
}

/** Tiny inline sparkline: 60×20 viewBox, stroke only, no axes — a texture
 *  of the trend, not a chart. Uses the tone's fill colour. */
function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null

  /*
    A TREND NEEDS SOMETHING TO TREND.

    With one non-zero day in fourteen this drew a flat line along the floor and
    then a vertical spike — an "L" that reads as a rendering fault rather than
    as data. It is not a fault; it is an accurate picture of a series that has
    nothing to say yet.

    That is every user's FIRST day, not an edge case, so the honest answer is to
    draw nothing until there is a shape worth drawing. Three non-zero points is
    the least that can describe a direction rather than an event.
  */
  if (data.filter((v) => v > 0).length < 3) return null
  const max = Math.max(...data, 1)
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * 58 + 1).toFixed(1)},${(19 - (v / max) * 16).toFixed(1)}`)
    .join(' ')
  return (
    <svg viewBox="0 0 60 20" aria-hidden className={cn('h-5 w-[3.75rem]', className)}>
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function StatCard({
  label,
  value,
  sublabel,
  icon,
  tone = 'neutral',
  trend,
  progress,
  spark,
  className,
}: {
  label: string
  value: React.ReactNode
  sublabel?: React.ReactNode
  icon?: React.ReactNode
  tone?: StatTone
  trend?: { value: string; direction: 'up' | 'down' | 'flat' }
  /** 0–1: renders a thin progress bar under the value (e.g. daily cap). */
  progress?: number
  /** Small series rendered as a sparkline beside the sublabel. */
  spark?: number[]
}& { className?: string }) {
  return (
    <Card
      className={cn(
        // Depth on hover only — transform+shadow, cheap to composite.
        'transition-shadow duration-200 hover:shadow-[0_1px_3px_0_rgb(15_23_42/0.06),0_10px_24px_-12px_rgb(15_23_42/0.14)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium text-ink-500">{label}</p>
          {/*
            Tabular figures so a value changing from 1,999 to 2,000 does not
            shift the layout — this sits next to a Realtime balance (§6.10).
          */}
          <p className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] tabular-nums text-ink-900">
            {value}
          </p>
          {progress !== undefined && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-100" role="presentation">
              <div
                className={cn('h-full rounded-full', STAT_BAR[tone])}
                style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
              />
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            {sublabel && <p className="text-[0.75rem] text-ink-400">{sublabel}</p>}
            {spark && (
              <Sparkline
                data={spark}
                className={cn(
                  tone === 'success' ? 'text-success-600'
                  : tone === 'brand' ? 'text-brand-600'
                  : tone === 'violet' ? 'text-violet-600'
                  : tone === 'teal' ? 'text-teal-600'
                  : tone === 'orange' ? 'text-orange-600'
                  : 'text-ink-400',
                )}
              />
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {icon && (
            <span
              className={cn(
                'grid size-9 place-items-center rounded-(--radius-input) border [&>svg]:size-4',
                STAT_CHIP[tone],
              )}
            >
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
