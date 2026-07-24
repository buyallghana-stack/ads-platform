'use client'

import { Delete } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * A PIN entry pad: filled/empty dots over a circular number pad, the delete key
 * a bare icon. Controlled — the parent owns the value and decides what happens
 * when it reaches `length`. Reused by the withdrawal PIN setup and the withdraw
 * wizard so the ceremony is identical everywhere.
 */
export function PinPad({
  value,
  onChange,
  length = 4,
  disabled = false,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  length?: number
  disabled?: boolean
  ariaLabel?: string
}) {
  const press = (key: string) => {
    if (disabled) return
    if (key === 'back') {
      onChange(value.slice(0, -1))
      return
    }
    if (value.length >= length) return
    onChange((value + key).slice(0, length))
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex gap-3" role="status" aria-label={ariaLabel}>
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'size-3.5 rounded-full border transition-colors duration-150',
              i < value.length ? 'border-brand-600 bg-brand-600' : 'border-ink-300',
            )}
          />
        ))}
      </div>

      <div className="mt-8 grid grid-cols-3 justify-items-center gap-x-5 gap-y-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map((key, i) =>
          key === '' ? (
            <span key={i} className="size-16 pointer-coarse:size-[4.25rem]" />
          ) : (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => press(key)}
              aria-label={key === 'back' ? 'Delete' : key}
              className={cn(
                'grid size-16 place-items-center rounded-full text-[1.625rem] font-semibold tabular-nums text-ink-900',
                'transition-[background-color,border-color,transform] duration-100 active:scale-90',
                'pointer-coarse:size-[4.25rem]',
                key === 'back'
                  ? 'text-ink-500 hover:text-ink-900 disabled:opacity-40'
                  : 'border border-ink-200 bg-surface hover:border-ink-300 hover:bg-ink-100 disabled:opacity-40',
              )}
            >
              {key === 'back' ? <Delete aria-hidden className="size-6" /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
