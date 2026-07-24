'use client'

import { useTransition } from 'react'

import { LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { logOutAction } from '@/app/[locale]/(auth)/actions'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Log out, in red (operator direction 2026-07-24). Two presentations:
 *
 *   default   an icon-only glyph for the Home header
 *   row       a full-width settings row (icon chip + label), for Profile
 *
 * Keeps its accessible name either way and dims while the sign-out request is
 * in flight.
 */
export function LogOutButton({ row = false, className }: { row?: boolean; className?: string }) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const signOut = () =>
    startTransition(async () => {
      await logOutAction()
      // refresh() clears the cached Server Component tree; without it the
      // signed-in shell can persist after the session is gone.
      router.replace('/login')
      router.refresh()
    })

  if (row) {
    return (
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
          'hover:bg-danger-50/60 disabled:opacity-50',
          className,
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-50 text-danger-600 [&>svg]:size-4.5">
          <LogOut aria-hidden />
        </span>
        <span className="text-[0.875rem] font-medium text-danger-600">{t('logOut')}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label={t('logOut')}
      title={t('logOut')}
      disabled={pending}
      onClick={signOut}
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
