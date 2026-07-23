'use client'

import { useEffect, useState } from 'react'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { cn } from '@/lib/cn'

/**
 * Light / System / Dark segmented control.
 *
 * This is the real toggle the user and admin dashboards will use — a three-way
 * choice, not a binary flip, because "System" (follow the OS) has to stay
 * selectable: it is the default, and a user who picked it should be able to
 * pick it again. next-themes persists the choice under the `theme` key and
 * re-applies it before paint on every load.
 *
 * Rendered null until mounted: on the server there is no resolved theme, so
 * drawing the active segment before hydration would flag the wrong one and
 * flicker. The guard is the standard next-themes pattern.
 */
const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-ink-200 bg-surface p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        // Before mount `theme` is undefined; render nothing selected rather
        // than guessing, so no segment flickers from active to inactive.
        const active = mounted && theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'grid size-8 place-items-center rounded-full transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
              active
                ? 'bg-brand-600 text-white'
                : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
