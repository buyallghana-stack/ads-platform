'use client'

import { useId } from 'react'

import { AlertCircle } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * Labelled text input with hint and error.
 *
 * Three accessibility details that matter more on an auth form than anywhere
 * else, because failing them locks people out rather than merely annoying them:
 *
 *   - the label is a real <label>, not a placeholder. Placeholder-as-label
 *     disappears the moment typing starts, which strands anyone who looks away.
 *   - errors are wired through aria-describedby and announced via role="alert",
 *     so a screen reader hears the problem instead of silently failing to submit.
 *   - the error is never colour-only: it carries an icon and text, for the
 *     roughly 8% of men with colour-vision deficiency.
 */
export function TextField({
  label,
  hint,
  error,
  optionalLabel,
  className,
  id: providedId,
  ...props
}: Omit<React.ComponentProps<'input'>, 'aria-describedby' | 'aria-invalid'> & {
  label: string
  hint?: string
  error?: string
  optionalLabel?: string
}) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-medium text-ink-700">
        {label}
        {optionalLabel && (
          <span className="text-xs font-normal text-ink-400">{optionalLabel}</span>
        )}
      </label>

      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'h-12 w-full rounded-[--radius-input] bg-white px-3.5 text-[0.9375rem] text-ink-900',
          'ring-1 ring-inset transition-shadow duration-150',
          'placeholder:text-ink-400',
          'focus:outline-none focus-visible:ring-2',
          error
            ? 'ring-danger-500 focus-visible:ring-danger-600'
            : 'ring-ink-300 hover:ring-ink-400 focus-visible:ring-brand-600',
          'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
        )}
        {...props}
      />

      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium text-danger-600"
        >
          <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
