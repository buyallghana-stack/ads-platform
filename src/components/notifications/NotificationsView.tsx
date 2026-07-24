'use client'

import { useMemo, useState, useTransition } from 'react'

import { BellOff, CheckCheck, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  clearNotifications,
  markAllNotificationsRead,
} from '@/app/[locale]/(app)/notifications/actions'
import type { NotificationRow } from '@/lib/notifications/data'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

import { NotificationCard } from './NotificationCard'

/**
 * The reusable notifications body: the reference's segmented time tabs
 * (Today / This Week / Earlier) over a divided feed, plus the operator's
 * "Read all" and "Clear all" actions. Shared by the desktop dropdown panel and
 * the mobile full page so the two never drift.
 *
 * Buckets are computed from the server-provided `now`, and the initial tab is
 * the first non-empty one, so opening the panel never lands on an empty view.
 * "Clear all" removes everything except flags — the button disables itself when
 * only flags remain, matching the rule the database enforces.
 */

type Tab = 'today' | 'week' | 'earlier'
const TABS: Tab[] = ['today', 'week', 'earlier']

const DAY = 86_400_000

function bucketOf(createdAt: string, startOfToday: number, weekAgo: number): Tab {
  const ts = new Date(createdAt).getTime()
  if (ts >= startOfToday) return 'today'
  if (ts >= weekAgo) return 'week'
  return 'earlier'
}

export function NotificationsView({
  notifications,
  now,
  variant,
}: {
  notifications: NotificationRow[]
  now: number
  variant: 'panel' | 'page'
}) {
  const t = useTranslations('notifications')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const { buckets, firstNonEmpty } = useMemo(() => {
    const startOfToday = new Date(now).setHours(0, 0, 0, 0)
    const weekAgo = now - 7 * DAY
    const map: Record<Tab, NotificationRow[]> = { today: [], week: [], earlier: [] }
    for (const n of notifications) map[bucketOf(n.created_at, startOfToday, weekAgo)].push(n)
    const firstNonEmpty = TABS.find((tab) => map[tab].length > 0) ?? 'today'
    return { buckets: map, firstNonEmpty }
  }, [notifications, now])

  const [tab, setTab] = useState<Tab>(firstNonEmpty)
  const active = buckets[tab]

  const hasUnread = notifications.some((n) => n.read_at === null)
  const hasClearable = notifications.some((n) => n.type !== 'flag')
  const isEmpty = notifications.length === 0

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      await fn()
      router.refresh()
    })

  if (isEmpty) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 px-6 text-center',
          variant === 'panel' ? 'py-12' : 'py-20',
        )}
      >
        <span className="grid size-12 place-items-center rounded-full bg-ink-100 text-ink-400">
          <BellOff aria-hidden className="size-5" />
        </span>
        <p className="text-[0.875rem] font-medium text-ink-700">{t('empty.title')}</p>
        <p className="max-w-[28ch] text-[0.8125rem] leading-relaxed text-ink-400">
          {t('empty.body')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Segmented time tabs — the reference's Today / This Week / Earlier. */}
      <div className="px-3 pt-3">
        <div
          role="tablist"
          aria-label={t('tabs.label')}
          className="flex gap-1 rounded-(--radius-input) bg-ink-100 p-1"
        >
          {TABS.map((tb) => {
            const selected = tb === tab
            const count = buckets[tb].length
            return (
              <button
                key={tb}
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(tb)}
                className={cn(
                  'flex-1 rounded-[calc(var(--radius-input)-0.25rem)] px-2 py-1.5 text-[0.8125rem] font-medium',
                  'transition-colors',
                  selected
                    ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                    : 'text-ink-500 hover:text-ink-700',
                )}
              >
                {t(`tabs.${tb}`)}
                {count > 0 && <span className="ml-1 text-ink-400 tabular-nums">{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Feed for the active bucket, divided like the reference. */}
      <div
        role="tabpanel"
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-3',
          variant === 'panel' && 'max-h-[22rem]',
        )}
      >
        {active.length === 0 ? (
          <p className="px-1 py-10 text-center text-[0.8125rem] text-ink-400">{t('emptyTab')}</p>
        ) : (
          <ul className="divide-y divide-ink-200/70">
            {active.map((n) => (
              <li key={n.id}>
                <NotificationCard notification={n} now={now} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions — Read all clears the badge, Clear all keeps flags. */}
      <div className="flex items-center gap-2 border-t border-ink-200 bg-ink-50 px-3 py-2.5">
        <button
          type="button"
          onClick={() => run(markAllNotificationsRead)}
          disabled={!hasUnread || pending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-(--radius-input) px-2.5 py-1.5 text-[0.8125rem] font-medium',
            'text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <CheckCheck aria-hidden className="size-4" />
          {t('actions.readAll')}
        </button>
        <button
          type="button"
          onClick={() => run(clearNotifications)}
          disabled={!hasClearable || pending}
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-(--radius-input) px-2.5 py-1.5 text-[0.8125rem] font-medium',
            'text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-600',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <Trash2 aria-hidden className="size-4" />
          {t('actions.clearAll')}
        </button>
      </div>
    </div>
  )
}
