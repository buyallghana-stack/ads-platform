'use client'

import { useTransition } from 'react'

import { useLocale } from 'next-intl'

import { usePathname, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Compact language switch (English / Français) for the Profile preferences.
 *
 * Switching re-navigates the current path under the other locale via the
 * next-intl router, which handles the as-needed prefix (en is bare, fr is
 * /fr). No stored preference is needed — the URL carries the locale.
 */
const LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
] as const

export function LanguageToggle() {
  const active = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className="inline-flex items-center gap-0.5 rounded-full border border-ink-200 bg-canvas p-0.5"
    >
      {LOCALES.map(({ code, label }) => {
        const selected = active === code
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={pending}
            onClick={() =>
              !selected && startTransition(() => router.replace(pathname, { locale: code }))
            }
            className={cn(
              'rounded-full px-2.5 py-1 text-[0.75rem] font-semibold transition-colors disabled:opacity-60',
              selected ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
