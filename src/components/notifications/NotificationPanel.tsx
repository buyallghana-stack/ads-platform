'use client'

import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { NotificationRow } from '@/lib/notifications/data'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

import { NotificationsView } from './NotificationsView'

/**
 * Desktop dropdown panel — the reference's "Notification Center" card: a soft
 * tinted, floating surface with a title and a "See All" link, over the shared
 * tabbed feed. Anchored under the bell by the parent; this component is just
 * the card.
 */
export function NotificationPanel({
  fullHref = '/notifications',
  notifications,
  unreadCount,
  now,
  onClose,
}: {
  notifications: NotificationRow[]
  unreadCount: number
  now: number
  onClose: () => void
  /** Where "see all" goes; the affiliate bell passes its own page. */
  fullHref?: string
}) {
  const t = useTranslations('notifications')

  return (
    <div
      role="dialog"
      aria-label={t('title')}
      className={cn(
        'flex max-h-[min(34rem,calc(100vh-5rem))] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden',
        'rounded-(--radius-panel) border border-ink-200 shadow-[0_12px_40px_-12px_rgb(15_23_42/0.28)]',
        // The reference's faint tint — a brand-tinted wash over the surface so
        // the card reads as an elevated "center", not a plain menu.
        'bg-gradient-to-b from-brand-50/60 to-surface',
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
          {unreadCount > 0 && (
            <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-brand-700 tabular-nums align-middle">
              {t('unreadCount', { count: unreadCount })}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          <Link
            href={fullHref}
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            {t('seeAll')}
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="grid size-8 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <NotificationsView notifications={notifications} now={now} variant="panel" />
    </div>
  )
}
