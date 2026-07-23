import { cn } from '@/lib/cn'

/**
 * Status badge.
 *
 * Every dashboard needs these — redemption status, ad status, risk level,
 * subscription state — so the tones are named after meaning rather than
 * colour. `tone="danger"` survives a palette change; `tone="red"` does not.
 *
 * Tinted background plus a matching border rather than a solid fill: a page
 * of solid pills is louder than the data it describes.
 */

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-50 text-ink-600 border-ink-200',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  success: 'bg-success-50 text-success-700 border-success-500/25',
  warning: 'bg-warning-50 text-warning-600 border-warning-500/25',
  danger: 'bg-danger-50 text-danger-700 border-danger-500/25',
}

const DOTS: Record<Tone, string> = {
  neutral: 'bg-ink-400',
  brand: 'bg-brand-600',
  success: 'bg-success-600',
  warning: 'bg-warning-500',
  danger: 'bg-danger-600',
}

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & {
  tone?: Tone
  /** Leading status dot. Useful when several badges sit in a table column. */
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-[0.75rem] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className={cn('size-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  )
}
