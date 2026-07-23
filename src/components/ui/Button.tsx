'use client'

import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * Button.
 *
 * Three details carry the look, and all three are easy to lose:
 *
 *   1. EVERY variant has a border, including the solid ones — a darker shade
 *      of its own fill rather than a neutral. A solid button with no border
 *      reads as a flat coloured rectangle; with one it reads as an object.
 *   2. Filled variants get a 1px inset highlight along the top edge, so they
 *      appear lit from above. Subtle enough to be invisible until removed.
 *   3. Small radius and a single tight shadow. Large radii and soft drop
 *      shadows are the template look this is deliberately not.
 *
 * Sizes align to the input scale (h-8 / h-9 / h-10) so a button beside a field
 * lines up without per-instance nudging.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const HIGHLIGHT = 'inset_0_1px_0_0_rgb(255_255_255/0.14)'
const LIFT = '0_1px_2px_0_rgb(15_23_42/0.08)'

const VARIANTS: Record<Variant, string> = {
  primary: cn(
    'bg-brand-600 text-white border-brand-700',
    `shadow-[${HIGHLIGHT},${LIFT}]`,
    'hover:bg-brand-700 hover:border-brand-800',
    'active:bg-brand-800',
    'disabled:hover:bg-brand-600 disabled:hover:border-brand-700',
  ),
  secondary: cn(
    'bg-white text-ink-700 border-ink-200',
    `shadow-[${LIFT}]`,
    'hover:bg-ink-50 hover:border-ink-300 hover:text-ink-900',
    'active:bg-ink-100',
    'disabled:hover:bg-white disabled:hover:border-ink-200',
  ),
  ghost: cn(
    'bg-transparent text-ink-600 border-transparent shadow-none',
    'hover:bg-ink-100 hover:text-ink-900',
    'active:bg-ink-200',
    'disabled:hover:bg-transparent',
  ),
  danger: cn(
    'bg-danger-600 text-white border-danger-700',
    `shadow-[${HIGHLIGHT},${LIFT}]`,
    'hover:bg-danger-700 hover:border-danger-700',
    'active:bg-danger-700',
    'disabled:hover:bg-danger-600',
  ),
}

/**
 * Sized by INPUT DEVICE, not screen width.
 *
 * The dense 32–36px control is a desktop developer-tool convention, and it is
 * genuinely too small for a thumb: 44px is the accepted minimum touch target,
 * and most of this platform's users are on phones. Rather than compromise on a
 * single middling height, `pointer-coarse` grows every control on touch and
 * leaves it tight for a mouse.
 *
 * Width breakpoints get this wrong in both directions — a tablet with a
 * trackpad would get fat controls, a small touchscreen laptop would get
 * fiddly ones. Pointer type is the thing that actually matters.
 */
const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-[0.8125rem] pointer-coarse:h-10 pointer-coarse:px-3',
  md: 'h-9 gap-2 px-3 text-[0.8125rem] pointer-coarse:h-11 pointer-coarse:px-3.5 pointer-coarse:text-sm',
  lg: 'h-10 gap-2 px-4 text-sm pointer-coarse:h-12 pointer-coarse:px-5',
}

const ICON_ONLY: Record<Size, string> = {
  sm: 'w-8 px-0 pointer-coarse:w-10 pointer-coarse:px-0',
  md: 'w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0',
  lg: 'w-10 px-0 pointer-coarse:w-12 pointer-coarse:px-0',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  iconOnly = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  /** Square button. Requires aria-label, since there is no text to name it. */
  iconOnly?: boolean
  leadingIcon?: React.ReactNode
  trailingIcon?: React.ReactNode
}) {
  return (
    <button
      // A loading button keeps focus and its accessible name; only aria-busy
      // changes. Disabling outright throws focus to the top of the page
      // mid-submit, which is disorienting on a form.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-[--radius-input] border',
        'font-medium tracking-[-0.006em] whitespace-nowrap',
        'transition-[background-color,border-color,color] duration-150',
        // Offset ring rather than a glow, so it stays legible on any surface.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        iconOnly && ICON_ONLY[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        leadingIcon && <span aria-hidden className="[&>svg]:size-3.5">{leadingIcon}</span>
      )}
      {!iconOnly && children}
      {iconOnly && !loading && <span aria-hidden className="[&>svg]:size-4">{children}</span>}
      {trailingIcon && !loading && (
        <span aria-hidden className="[&>svg]:size-3.5">{trailingIcon}</span>
      )}
    </button>
  )
}
