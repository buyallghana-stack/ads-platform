'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'

const LENGTH = 6

/**
 * Six-box verification code entry.
 *
 * Deceptively fiddly. What separates a good one from a frustrating one:
 *
 *   - PASTE fills every box. People copy the whole code out of their email;
 *     a field that accepts only the first character is the single most common
 *     failure of this pattern.
 *   - autoComplete="one-time-code" lets iOS and Android offer the code from
 *     the SMS or mail notification. It only works on the FIRST box, which is
 *     why only that one carries it.
 *   - inputMode="numeric" brings up the digit keypad rather than the full
 *     keyboard.
 *   - Backspace in an empty box moves back and clears the previous one, which
 *     is what people expect when correcting a typo.
 *   - Arrow keys move between boxes without altering values.
 *   - Auto-submits on the sixth digit. Making someone reach for a button after
 *     typing six digits is a pointless extra step.
 *
 * Accessibility: the boxes are a labelled group, each with its own position
 * announced. A screen reader user hears "Digit 3 of 6" rather than six
 * identically-named fields.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  digitLabel,
  error,
  disabled,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  label: string
  /** Template containing {position}, e.g. "Digit {position} of 6". */
  digitLabel: (position: number) => string
  error?: string
  disabled?: boolean
  autoFocus?: boolean
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  const digits = value.padEnd(LENGTH, ' ').slice(0, LENGTH).split('')

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const setAt = (index: number, digit: string) => {
    const next = digits.map((d, i) => (i === index ? digit : d)).join('').trimEnd()
    onChange(next)
    return next
  }

  const handleInput = (index: number, raw: string) => {
    const digitsOnly = raw.replace(/\D/g, '')
    if (!digitsOnly) return

    // More than one character means a paste (or a fast autofill) — spread it
    // across the boxes from here rather than keeping only the first.
    if (digitsOnly.length > 1) {
      const merged = (value.slice(0, index) + digitsOnly).slice(0, LENGTH)
      onChange(merged)
      const landing = Math.min(merged.length, LENGTH - 1)
      refs.current[landing]?.focus()
      if (merged.length === LENGTH) onComplete?.(merged)
      return
    }

    const next = setAt(index, digitsOnly)
    if (index < LENGTH - 1) refs.current[index + 1]?.focus()
    if (next.length === LENGTH && !next.includes(' ')) onComplete?.(next)
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[index] !== ' ') {
        setAt(index, ' ')
      } else if (index > 0) {
        setAt(index - 1, ' ')
        refs.current[index - 1]?.focus()
      }
      return
    }

    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      refs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < LENGTH - 1) {
      e.preventDefault()
      refs.current[index + 1]?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span id="code-input-label" className="text-[0.8125rem] font-medium text-ink-700">
        {label}
      </span>

      <div
        role="group"
        aria-labelledby="code-input-label"
        aria-describedby={error ? 'code-input-error' : undefined}
        className="flex gap-2"
      >
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="text"
            inputMode="numeric"
            // Only the first box gets this; the OS offers the code there.
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={LENGTH}
            value={digit.trim()}
            disabled={disabled}
            aria-label={digitLabel(index + 1)}
            aria-invalid={error ? true : undefined}
            onChange={(e) => handleInput(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onFocus={(e) => {
              setFocusedIndex(index)
              e.target.select()
            }}
            onBlur={() => setFocusedIndex(null)}
            className={cn(
              'h-12 w-full min-w-0 rounded-[--radius-input] border bg-white text-center',
              'text-lg font-semibold tabular-nums text-ink-900',
              'transition-[border-color,box-shadow] duration-150 focus:outline-none',
              'pointer-coarse:h-14 pointer-coarse:text-xl',
              error
                ? 'border-danger-500 focus:border-danger-600 focus:shadow-[0_0_0_3px] focus:shadow-danger-500/12'
                : focusedIndex === index
                  ? 'border-brand-600 shadow-[0_0_0_3px] shadow-brand-600/12'
                  : 'border-ink-200 hover:border-ink-300',
              'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
            )}
          />
        ))}
      </div>

      {error && (
        <p id="code-input-error" role="alert" className="text-[0.75rem] font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  )
}
