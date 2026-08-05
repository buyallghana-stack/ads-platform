'use client'

import { PlayCircle, Store } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import { MODE_HOME, modeForPath } from '@/lib/market/mode'

/**
 * The switch between the two businesses.
 *
 * A SEGMENTED control rather than a single "go to the shop" button, because a
 * button only tells you where you can go. This has to answer a second question
 * first — *which business am I looking at right now* — since the two have
 * separate money and a user who misreads that will misread a balance. Showing
 * both halves with one lit is the cheapest way to answer both at once.
 *
 * Colour follows the platform rule and is worth restating at the point of use:
 * jade marks the MODE, never a status. Market mode's money still uses
 * `success` for in and `danger` for out, exactly as the ads side does. If a
 * jade chip ever appears next to a figure, that is the bug.
 *
 * Not hidden for users without an affiliate account. Somebody who has never
 * bought training should still see that a second business exists — the switch
 * is this product's own advertisement for it, and Market mode's dashboard
 * handles the "you are not an affiliate yet" case as a designed screen rather
 * than an error.
 */
export function ModeSwitch({ className }: { className?: string }) {
  const t = useTranslations('mode')
  const pathname = usePathname()
  const active = modeForPath(pathname)

  const OPTIONS = [
    { mode: 'earn', Icon: PlayCircle, on: 'bg-surface text-brand-700 shadow-sm' },
    { mode: 'market', Icon: Store, on: 'bg-surface text-jade-700 shadow-sm' },
  ] as const

  return (
    <div
      className={cn(
        'flex gap-0.5 rounded-(--radius-input) bg-ink-100 p-0.5',
        // The track needs its own hairline or it dissolves into the sidebar,
        // which is the same tone in dark.
        'ring-hairline',
        className,
      )}
    >
      {OPTIONS.map(({ mode, Icon, on }) => {
        const current = active === mode
        return (
          <Link
            key={mode}
            href={MODE_HOME[mode]}
            aria-current={current ? 'true' : undefined}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-input)-0.15rem)]',
              'px-2.5 py-1.5 text-[0.8125rem] font-semibold whitespace-nowrap',
              'transition-colors',
              current ? on : 'text-ink-500 hover:text-ink-800',
            )}
          >
            <Icon aria-hidden className="size-4" strokeWidth={current ? 2.4 : 2} />
            {t(mode)}
          </Link>
        )
      })}
    </div>
  )
}
