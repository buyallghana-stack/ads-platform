'use client'

import { Megaphone, MessageCircle, ShieldAlert, Wallet } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import type { NotificationRow, NotificationType } from '@/lib/notifications/data'
import { cn } from '@/lib/cn'

/**
 * One notification, in the operator's typed colour language over the reference
 * layout (circular icon chip, title with an unread dot, a relative timestamp,
 * body beneath):
 *
 *   announcement -> yellow (Megaphone)
 *   payout       -> green  (Wallet)
 *   flag         -> red    (ShieldAlert) + a "Contact support" action
 *
 * Colour lives in the icon chip and the unread dot, echoing the StatCard tone
 * chips elsewhere, so the type reads at a glance without shouting.
 */

const TYPE_META: Record<
  NotificationType,
  { Icon: typeof Megaphone; chip: string; dot: string }
> = {
  announcement: {
    Icon: Megaphone,
    chip: 'border-warning-500/25 bg-warning-50 text-warning-600',
    dot: 'bg-warning-500',
  },
  payout: {
    Icon: Wallet,
    chip: 'border-success-500/25 bg-success-50 text-success-600',
    dot: 'bg-success-500',
  },
  flag: {
    Icon: ShieldAlert,
    chip: 'border-danger-500/25 bg-danger-50 text-danger-600',
    dot: 'bg-danger-500',
  },
  /* A reply from support is informational, not an alarm — brand blue, and
     deliberately NOT the danger red the flag card owns. The one colour that
     means "something is wrong with your account" has to keep meaning only
     that. */
  support: {
    Icon: MessageCircle,
    chip: 'border-brand-600/25 bg-brand-50 text-brand-600',
    dot: 'bg-brand-600',
  },
}

export function NotificationCard({
  notification,
  now,
}: {
  notification: NotificationRow
  /** Server-provided reference time (ms) so relative labels are pure and
   *  hydration-stable rather than reading the clock during render. */
  now: number
}) {
  const t = useTranslations('notifications')
  const format = useFormatter()
  const { Icon, chip, dot } = TYPE_META[notification.type]
  const unread = notification.read_at === null

  return (
    <div className="flex gap-3 px-1 py-3.5">
      <span
        className={cn(
          'mt-0.5 grid size-10 shrink-0 place-items-center rounded-full border [&>svg]:size-[1.15rem]',
          chip,
        )}
      >
        <Icon aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[0.9375rem] font-semibold leading-tight text-ink-900">
            {unread && (
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot)} />
            )}
            <span className="min-w-0">{notification.title}</span>
          </h3>
          <time
            dateTime={notification.created_at}
            className="shrink-0 pt-0.5 text-[0.75rem] text-ink-400 tabular-nums"
          >
            {format.relativeTime(new Date(notification.created_at), now)}
          </time>
        </div>

        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">{notification.body}</p>

        {/* `about` travels with the first message, so support opens the
            conversation already knowing which notification brought them —
            their first question is always "which one?". */}
        {notification.type === 'flag' && (
          <Link
            href={{ pathname: '/support', query: { about: 'flag' } }}
            className={cn(
              'mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-danger-500/30 bg-surface px-3 py-1.5',
              'text-[0.75rem] font-medium text-danger-600 transition-colors',
              'hover:bg-danger-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500',
            )}
          >
            <MessageCircle aria-hidden className="size-3.5" />
            {t('contactSupport')}
          </Link>
        )}

        {notification.type === 'support' && (
          <Link
            href="/support"
            className={cn(
              'mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-brand-600/30 bg-surface px-3 py-1.5',
              'text-[0.75rem] font-medium text-brand-700 transition-colors',
              'hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
            )}
          >
            <MessageCircle aria-hidden className="size-3.5" />
            {t('openSupport')}
          </Link>
        )}
      </div>
    </div>
  )
}
