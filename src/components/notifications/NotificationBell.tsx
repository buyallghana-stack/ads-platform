'use client'

import { useEffect, useRef, useState } from 'react'

import { Bell } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { NotificationRow } from '@/lib/notifications/data'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

import { NotificationPanel } from './NotificationPanel'

/**
 * Bell + unread badge for the Home header.
 *
 *   below md   the bell is a link straight to the full /notifications page —
 *              a dropdown has nowhere to go on a phone.
 *   md and up  the bell opens the reference dropdown panel, anchored beneath
 *              it, closing on outside-click or Escape.
 *
 * The badge count and the panel's contents are handed down from the server
 * (Home header), so the first paint already knows the unread count — no
 * loading flash on the badge.
 */
export function NotificationBell({
  notifications,
  unreadCount,
  now,
  fullHref = '/notifications',
}: {
  notifications: NotificationRow[]
  unreadCount: number
  now: number
  /** Where "see all" goes. The affiliate bell has its own page, because a
   *  notification now belongs to one business and the list has to stay inside
   *  the mode it was read from. */
  fullHref?: string
}) {
  const t = useTranslations('notifications')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close the desktop panel on outside-click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const badge =
    unreadCount > 0 ? (
      <span
        aria-hidden
        className={cn(
          'absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger-600 px-1',
          /* Ring is `surface`, not `canvas`: since the Home header grouped the
             three icons into a bordered pill the bell sits on a raised sheet,
             and a canvas-coloured ring cut a visible notch out of it.
             (`ring-[--color-canvas]` was also the v3 arbitrary-value syntax,
             which Tailwind 4 does not compile — so this ring was not being
             drawn at all.) */
          'text-[0.625rem] font-bold leading-4 text-white ring-2 ring-surface',
        )}
      >
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    ) : null

  const bellClasses = cn(
    'relative grid size-9 place-items-center rounded-full text-ink-500 transition-colors',
    'hover:bg-ink-100 hover:text-ink-900',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
    'pointer-coarse:size-10',
  )

  const label = t('bellLabel', { count: unreadCount })

  return (
    <div ref={wrapRef} className="relative">
      {/* Phone: navigate to the full page. */}
      <Link href={fullHref} aria-label={label} className={cn(bellClasses, 'md:hidden')}>
        <Bell aria-hidden className="size-[1.15rem]" />
        {badge}
      </Link>

      {/* md+: toggle the dropdown panel. */}
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(bellClasses, 'hidden md:grid', open && 'bg-ink-100 text-ink-900')}
      >
        <Bell aria-hidden className="size-[1.15rem]" />
        {badge}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 hidden md:block">
          <NotificationPanel
            fullHref={fullHref}
            notifications={notifications}
            unreadCount={unreadCount}
            now={now}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
