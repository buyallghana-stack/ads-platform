'use client'

import { useId } from 'react'

import { Check } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * Checkbox with a real label.
 *
 * The native input stays in the DOM and keeps focus and keyboard behaviour;
 * the tick is decorative. Replacing the input with a styled div is the usual
 * shortcut and it breaks space-to-toggle, form submission and every assistive
 * technology at once.
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
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-2 pointer-coarse:gap-2.5">
        <span className="relative mt-[0.1875rem] flex size-4 shrink-0 pointer-coarse:mt-0.5 pointer-coarse:size-[1.125rem]">
          <input
            id={id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              'peer size-full cursor-pointer appearance-none rounded-[4px] border bg-surface',
              'transition-colors duration-150',
              'border-ink-300 hover:border-ink-400',
              'checked:border-brand-600 checked:bg-brand-600 checked:hover:bg-brand-700',
              'focus:outline-none focus-visible:border-brand-600',
              'focus-visible:shadow-[0_0_0_3px] focus-visible:shadow-brand-600/12',
              'aria-[invalid]:border-danger-500',
              /*
                A 16-18px box is a poor thumb target, but drawing a 44px box
                would look clumsy next to 13px text. The pseudo-element
                extends the TAPPABLE area to 44px without changing anything
                visible — the standard fix, and the reason the checkbox does
                not need to grow to be usable.
              */
              'pointer-coarse:before:absolute pointer-coarse:before:left-1/2 pointer-coarse:before:top-1/2',
              'pointer-coarse:before:size-11 pointer-coarse:before:-translate-x-1/2 pointer-coarse:before:-translate-y-1/2',
              'pointer-coarse:before:content-[""]',
            )}
            {...props}
          />
          <Check
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto size-2.5 text-white opacity-0 transition-opacity peer-checked:opacity-100 pointer-coarse:size-3"
            strokeWidth={3.5}
          />
        </span>

        <label
          htmlFor={id}
          className="cursor-pointer text-[0.8125rem] leading-[1.45] text-ink-600 pointer-coarse:text-sm pointer-coarse:leading-[1.5]"
        >
          {label}
        </label>
      </div>

      {error && (
        <p id={errorId} role="alert" className="pl-6 text-[0.75rem] font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  )
}
