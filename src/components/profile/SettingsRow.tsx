import { ChevronRight } from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * A grouped-settings list, in the style of the operator's Profile reference:
 * rows sit inside a single card divided by hairlines, each with a colour-coded
 * icon chip, a label, an optional value, and a trailing control.
 *
 * SettingsGroup is the card; SettingsRow is one line. A row is a link (href),
 * an action (the caller wraps its own client control in `trailing`), or a
 * plain value display.
 */

type Tone = 'neutral' | 'brand' | 'success' | 'violet' | 'teal' | 'orange' | 'danger'

const CHIP: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-500',
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-success-50 text-success-600',
  violet: 'bg-violet-50 text-violet-600',
  teal: 'bg-teal-50 text-teal-600',
  orange: 'bg-orange-50 text-orange-600',
  danger: 'bg-danger-50 text-danger-600',
}

export function SettingsGroup({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {title && (
        <h2 className="mb-2 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-400">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="divide-y divide-ink-100">{children}</div>
      </div>
    </section>
  )
}

function RowInner({
  icon,
  tone = 'neutral',
  label,
  description,
  value,
  trailing,
  danger = false,
  soon,
  showChevron = true,
}: RowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {icon && (
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full [&>svg]:size-4.5', CHIP[danger ? 'danger' : tone])}>
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('text-[0.875rem] font-medium', danger ? 'text-danger-600' : 'text-ink-900')}>
          {label}
        </p>
        {description && <p className="mt-0.5 truncate text-[0.75rem] text-ink-500">{description}</p>}
      </div>

      {value && <span className="shrink-0 text-[0.8125rem] text-ink-500">{value}</span>}
      {soon && <Badge tone="neutral">{soon}</Badge>}
      {trailing}
      {showChevron && !trailing && !soon && (
        <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-300" />
      )}
    </div>
  )
}

type RowProps = {
  icon?: React.ReactNode
  tone?: Tone
  label: React.ReactNode
  description?: React.ReactNode
  /** Right-aligned value text (e.g. "English"). */
  value?: React.ReactNode
  /** A custom trailing control (a client toggle). Replaces the chevron. */
  trailing?: React.ReactNode
  danger?: boolean
  /** The localized "Soon" label when the destination is designed, not built. */
  soon?: string
  showChevron?: boolean
}

export function SettingsRow(props: RowProps & { href?: string }) {
  const { href, ...rest } = props

  if (href && !rest.soon) {
    return (
      <Link
        href={href}
        className="block transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-none"
      >
        <RowInner {...rest} />
      </Link>
    )
  }
  return <RowInner {...rest} />
}
