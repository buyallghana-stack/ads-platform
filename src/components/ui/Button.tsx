'use client'

import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

/**
 * Buttons sized to match the inputs — 36px, 6px radius, 14px medium text.
 *
 * The primary is a solid brand fill with a slightly darker inset top edge,
 * which gives it a physical read at 1px rather than relying on a drop shadow.
 * A large soft shadow under a saturated slab is the look this is avoiding.
 */
const VARIANTS: Record<Variant, string> = {
  primary: cn(
    'bg-brand-600 text-white',
    'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.16),0_1px_2px_0_rgb(0_0_0/0.08)]',
    'hover:bg-brand-700 active:bg-brand-800',
    'disabled:hover:bg-brand-600',
  ),
  secondary: cn(
    'bg-white text-ink-700 border border-ink-200',
    'shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]',
    'hover:bg-ink-50 hover:border-ink-300 active:bg-ink-100',
    'disabled:hover:bg-white',
  ),
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[0.8125rem]',
  md: 'h-9 px-3.5 text-sm',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
}) {
  return (
    <button
      // A loading button keeps focus and its accessible name; only aria-busy
      // changes. Disabling outright would throw focus to the top of the page
      // mid-submit.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-[--radius-input]',
        'font-medium tracking-[-0.006em] transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
      {children}
    </button>
  )
}
