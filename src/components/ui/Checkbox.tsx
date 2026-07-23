'use client'

import { useId } from 'react'

import { AlertCircle, Check } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * Checkbox with a real label.
 *
 * The native input stays in the DOM and keeps focus and keyboard behaviour;
 * the visible box is decorative. Replacing the input with a styled div is the
 * usual shortcut here and it breaks space-to-toggle, form submission and every
 * assistive technology at once.
 */
export function Checkbox({
  label,
  error,
  className,
  id: providedId,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & {
  label: React.ReactNode
  error?: string
}) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const errorId = `${id}-error`

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-start gap-2.5">
        <span className="relative mt-0.5 flex size-[1.125rem] shrink-0">
          <input
            id={id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="peer size-full cursor-pointer appearance-none rounded-[5px] bg-white ring-1 ring-inset ring-ink-300 transition-colors checked:bg-brand-600 checked:ring-brand-600 hover:ring-ink-400 checked:hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 aria-[invalid]:ring-danger-500"
            {...props}
          />
          <Check
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 transition-opacity peer-checked:opacity-100"
            strokeWidth={3}
          />
        </span>

        <label htmlFor={id} className="cursor-pointer text-sm leading-[1.4] text-ink-600">
          {label}
        </label>
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 pl-7 text-xs font-medium text-danger-600"
        >
          <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
