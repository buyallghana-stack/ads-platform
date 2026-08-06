'use client'

import { useTranslations } from 'next-intl'

import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * 7 / 30 / 90 days.
 *
 * LINKS, not a select or a client-side filter. The window is part of what the
 * page IS — every figure on the screen is scoped to it — so it belongs in the
 * URL: it survives a reload, it can be shared, the back button undoes it, and
 * the whole page including the aggregates is re-rendered on the server rather
 * than the client refetching and holding two versions of the truth.
 *
 * The reference draws this as a "This Month ▾" dropdown. A dropdown hides the
 * options behind a tap and, at three of them, costs more than it saves; three
 * segments are all visible, all one tap, and show the current state without
 * being opened. It is also the same segmented control the rest of the app uses,
 * so it needs no explanation.
 */
const OPTIONS = [7, 30, 90] as const

export function PeriodPicker({ days }: { days: number }) {
  const t = useTranslations('affiliate.period')
  const pathname = usePathname()

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/25 p-0.5 ring-1 ring-white/10"
    >
      {OPTIONS.map((n) => {
        const active = n === days
        return (
          <Link
            key={n}
            href={{ pathname, query: n === 30 ? {} : { days: String(n) } }}
            aria-current={active ? 'true' : undefined}
            scroll={false}
            className={cn(
              'rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold tabular-nums transition-colors',
              'pointer-coarse:px-3 pointer-coarse:py-1.5',
              active ? 'bg-white/95 text-brand-950' : 'text-white/70 hover:text-white',
            )}
          >
            {t('days', { n })}
          </Link>
        )
      })}
    </div>
  )
}
