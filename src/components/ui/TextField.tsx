'use client'

import { useId } from 'react'

import { cn } from '@/lib/cn'

/**
 * Labelled text input.
 *
 * Sizing follows the dense, technical convention rather than the roomy
 * marketing-page one: 36px tall, 6px radius, 14px text, a hairline border
 * that darkens on hover, and a thin two-tone focus state — border in brand,
 * plus a low-opacity halo. Tall pill-shaped inputs are the clearest signal of
 * an untouched template.
 *
 * Accessibility, which matters more here than on any other form because the
 * failure mode is being locked out rather than inconvenienced:
 *   - a real <label>, never placeholder-as-label
 *   - errors wired through aria-describedby and announced via role="alert"
 *   - error state never carried by colour alone
 */
export function TextField({
  label,
  hint,
  error,
  optionalLabel,
  className,
  inputClassName,
  id: providedId,
  ...props
}: Omit<React.ComponentProps<'input'>, 'aria-describedby' | 'aria-invalid'> & {
  label: string
  hint?: string
  error?: string
  optionalLabel?: string
  /** Applied to the <input>. Keep presentation off the wrapper — putting
   *  `uppercase` on the wrapper also shouted the label. */
  inputClassName?: string
}) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className="flex items-baseline justify-between text-[0.8125rem] font-medium text-ink-700"
      >
        <span>{label}</span>
        {optionalLabel && (
          <span className="text-[0.75rem] font-normal text-ink-400">{optionalLabel}</span>
        )}
      </label>

      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'h-9 w-full rounded-[--radius-input] bg-white px-3 text-sm text-ink-900',
          'border transition-[border-color,box-shadow] duration-150',
          'placeholder:text-ink-400',
          'focus:outline-none',
          error
            ? 'border-danger-500 focus:border-danger-600 focus:shadow-[0_0_0_3px] focus:shadow-danger-500/12'
            : 'border-ink-200 hover:border-ink-300 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12',
          'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
          inputClassName,
        )}
        {...props}
      />

      {hint && !error && (
        <p id={hintId} className="text-[0.75rem] leading-snug text-ink-400">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-[0.75rem] font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  )
}
