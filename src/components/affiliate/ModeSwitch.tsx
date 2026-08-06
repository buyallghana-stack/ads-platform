'use client'

import { ArrowLeftRight, PlayCircle, Store } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import { MODE_HOME, type AppMode } from '@/lib/market/mode'

/**
 * The one control that crosses between the two businesses.
 *
 * ── WHAT IT MUST NOT BE ──
 *
 * Not a toggle. A toggle implies a setting that persists, and mode is derived
 * from the URL and never stored (`mode.ts`) — a switch that looks stateful
 * beside a mode that is not is how you end up with a control claiming you are
 * somewhere you are not.
 *
 * So it is a LINK, and it says where it goes rather than what it is. It always
 * lands on the other business's home, never a sub-screen: arriving in a
 * business you have just entered, three levels deep, on a screen whose chrome
 * you have never seen, is disorienting in a way no label fixes.
 *
 * ── WHY IT IS ALSO THE ANSWER TO "WHERE IS MY POINTS BALANCE" ──
 *
 * D27 says points and commission never mix, and the mode boundary is what
 * makes that structural rather than a rule somebody has to remember. The cost
 * is that a user holding both will look for one balance while standing in the
 * other. This control is the whole of the answer, so it is never hidden behind
 * a menu: pinned in the sidebar on md+, and in the header on a phone.
 */

/** Rendered in the affiliate sidebar's pinned footer. */
export function ModeSwitchCard({ to }: { to: AppMode }) {
  const t = useTranslations('affiliate.mode')
  const earn = to === 'earn'

  return (
    <Link
      href={MODE_HOME[to]}
      className={cn(
        'group block rounded-(--radius-card) border border-ink-200 bg-ink-50 p-3 transition-colors',
        'hover:border-brand-600/45 hover:bg-brand-50',
      )}
    >
      <span className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-400">
        <ArrowLeftRight aria-hidden className="size-3.5" />
        {t('switchTo')}
      </span>
      <span className="mt-1.5 flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-900">
        {earn ? (
          <PlayCircle aria-hidden className="size-4 text-brand-700" />
        ) : (
          <Store aria-hidden className="size-4 text-brand-700" />
        )}
        {t(earn ? 'earnName' : 'marketName')}
      </span>
      <span className="mt-0.5 block text-[0.75rem] leading-snug text-ink-500">
        {t(earn ? 'earnBody' : 'marketBody')}
      </span>
    </Link>
  )
}

/**
 * Header form, for phones. Compact enough to sit beside a title, explicit
 * enough that it is not mistaken for a back button — which is exactly what a
 * bare arrow in that position would read as.
 */
export function ModeSwitchButton({ to, className }: { to: AppMode; className?: string }) {
  const t = useTranslations('affiliate.mode')
  const earn = to === 'earn'

  return (
    <Link
      href={MODE_HOME[to]}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-surface px-3 py-1.5',
        'text-[0.75rem] font-semibold text-ink-700 transition-colors',
        'hover:border-brand-600/45 hover:text-brand-700',
        'pointer-coarse:py-2',
        className,
      )}
    >
      {earn ? (
        <PlayCircle aria-hidden className="size-3.5" />
      ) : (
        <Store aria-hidden className="size-3.5" />
      )}
      {t(earn ? 'earnName' : 'marketName')}
    </Link>
  )
}
