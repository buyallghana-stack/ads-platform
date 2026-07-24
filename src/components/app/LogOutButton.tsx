'use client'

import { useTransition } from 'react'

import { LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { logOutAction } from '@/app/[locale]/(auth)/actions'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Log out — icon only, in red (operator direction 2026-07-24).
 *
 * A bare glyph rather than a labelled button: it sits in the Home header
 * beside the theme switch, and red is the universal "this ends your session"
 * signal. Keeps its accessible name via aria-label, and dims while the
 * sign-out request is in flight.
 */
export function LogOutButton({ className }: { className?: string }) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      aria-label={t('logOut')}
      title={t('logOut')}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await logOutAction()
          // refresh() clears the cached Server Component tree; without it the
          // signed-in shell can persist after the session is gone.
          router.replace('/login')
          router.refresh()
        })
      }
      className={cn(
        'grid size-9 place-items-center rounded-full text-danger-600 transition-colors',
        'hover:bg-danger-50 hover:text-danger-700',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500',
        'disabled:opacity-50 pointer-coarse:size-10',
        className,
      )}
    >
      <LogOut aria-hidden className="size-[1.15rem]" />
    </button>
  )
}
