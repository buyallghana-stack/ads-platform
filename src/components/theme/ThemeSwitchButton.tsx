'use client'

import { useEffect, useState } from 'react'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'

import { cn } from '@/lib/cn'

/**
 * Compact one-tap theme switch for the Home header.
 *
 * A single icon button that cycles System -> Light -> Dark -> System, showing
 * the current choice. The full three-way segmented control (ThemeToggle) still
 * lives on the styleguide and will go in Profile; this is the quick switch the
 * operator asked for beside the logout.
 *
 * Renders a neutral placeholder until mounted so the server markup and the
 * first client paint agree (next-themes has no resolved theme on the server).
 */
const ORDER = ['system', 'light', 'dark'] as const
const ICON = { system: Monitor, light: Sun, dark: Moon }

export function ThemeSwitchButton({ className }: { className?: string }) {
  const t = useTranslations('theme')
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const current = (mounted && (theme as (typeof ORDER)[number])) || 'system'
  const Icon = ICON[current] ?? Monitor

  const next = () => {
    const i = ORDER.indexOf(current)
    setTheme(ORDER[(i + 1) % ORDER.length])
  }

  return (
    <button
      type="button"
      onClick={next}
      aria-label={t('switch', { mode: mounted ? t(current) : '' })}
      title={mounted ? t(current) : undefined}
      className={cn(
        'grid size-9 place-items-center rounded-full text-ink-500 transition-colors',
        'hover:bg-ink-100 hover:text-ink-900',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
        'pointer-coarse:size-10',
        className,
      )}
    >
      {/* Suppress hydration text swap: icon depends on resolved theme. */}
      <Icon aria-hidden className="size-[1.15rem]" suppressHydrationWarning />
    </button>
  )
}
