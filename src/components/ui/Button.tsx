'use client'

import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 ' +
    'shadow-sm shadow-brand-600/20 disabled:hover:bg-brand-600',
  secondary:
    'bg-white text-ink-700 ring-1 ring-inset ring-ink-300 hover:bg-ink-50 ' +
    'active:bg-ink-100 disabled:hover:bg-white',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50 active:bg-brand-100',
}

const SIZES: Record<Size, string> = {
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-[0.9375rem]',
}

export function Button({
  variant = 'primary',
  size = 'lg',
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
      // A loading button stays focusable and keeps its accessible name; only
      // `aria-busy` changes. Disabling it outright would move focus to the top
      // of the page mid-submit, which is disorienting on a form.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-[--radius-input]',
        'font-semibold tracking-[-0.01em] transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  )
}
