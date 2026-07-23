import { cn } from '@/lib/cn'

/**
 * Wordmark. The glyph is a play triangle sitting inside a coin — watch, then
 * earn — which is the whole product in one shape.
 *
 * Placeholder until the operator supplies real brand assets. Deliberately
 * simple so replacing it is a single-file change.
 */
export function Logo({
  className,
  variant = 'light',
  showWordmark = true,
}: {
  className?: string
  /** 'light' for use on the blue panel, 'dark' for use on white. */
  variant?: 'light' | 'dark'
  showWordmark?: boolean
}) {
  const isLight = variant === 'light'

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 32 32"
        className="size-8 shrink-0"
        role="img"
        aria-label="AdReward"
      >
        <circle
          cx="16"
          cy="16"
          r="15"
          fill="none"
          strokeWidth="2"
          className={isLight ? 'stroke-white' : 'stroke-brand-600'}
        />
        <circle
          cx="16"
          cy="16"
          r="10.5"
          className={isLight ? 'fill-white/15' : 'fill-brand-600/10'}
        />
        <path
          d="M13.4 11.6v8.8l7.4-4.4z"
          className={isLight ? 'fill-white' : 'fill-brand-600'}
        />
      </svg>

      {showWordmark && (
        <span
          className={cn(
            'text-[1.0625rem] font-semibold tracking-[-0.02em]',
            isLight ? 'text-white' : 'text-ink-900',
          )}
        >
          AdReward
        </span>
      )}
    </span>
  )
}
