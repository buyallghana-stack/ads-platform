import { cn } from '@/lib/cn'

/**
 * Centered header for auth screens: a small icon chip in a rounded square,
 * then title and subtitle — the composition every reference shares. The chip
 * doubles as the brand mark on mobile, where the promo panel (and its logo)
 * is not rendered.
 */
export function FormHeader({
  icon,
  title,
  subtitle,
  tone = 'brand',
  className,
}: {
  /** Rendered inside the chip. A lucide icon or the Logo glyph. */
  icon: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** success turns the chip green, for terminal "done" screens. */
  tone?: 'brand' | 'success'
  className?: string
}) {
  return (
    <header className={cn('mb-7 flex flex-col items-center text-center', className)}>
      <span
        aria-hidden
        className={cn(
          'grid size-12 place-items-center rounded-[0.875rem]',
          tone === 'success'
            ? 'border border-success-500/25 bg-success-50 text-success-600'
            : 'border border-ink-200 bg-surface text-brand-600',
          'shadow-[0_1px_2px_rgb(15_23_42/0.05),0_4px_10px_-4px_rgb(15_23_42/0.1)]',
          // Descendant selector so it reaches both a bare lucide icon and
          // the svg inside the Logo glyph's wrapping span.
          '[&_svg]:size-6',
        )}
      >
        {icon}
      </span>
      <h2 className="mt-4 text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1.5 max-w-[34ch] text-[0.8125rem] leading-relaxed text-ink-500">
          {subtitle}
        </p>
      )}
    </header>
  )
}
