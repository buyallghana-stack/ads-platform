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
 *
 * ⚠️ IT MUST BE RENDERED AT BOTH BREAKPOINTS, ON BOTH SIDES. The first version
 * of this existed only in the sidebar, which is `md:flex` — so on a phone there
 * was no route into the affiliate business at all, and the bug was invisible in
 * the source because the component was plainly imported and used. The way to
 * check it is to assert on VISIBLE links in a browser at 390px, not to read the
 * markup; `.first()` happily matches the hidden desktop copy.
 *
 * ── THE COLOUR IS THE DESTINATION'S, NOT THE CURRENT MODE'S ──
 *
 * Pointing at the affiliate business it wears violet; pointing back at the ads
 * business it wears brand. That is what makes it read as a door rather than as
 * another button on the page you are already on — and inside the affiliate
 * skin `brand` IS violet, so the same two rules give the right answer on both
 * sides without either side special-casing the other.
 */

/** Rendered in the affiliate sidebar's pinned footer. */
export function ModeSwitchCard({ to, className }: { to: AppMode; className?: string }) {
  const t = useTranslations('affiliate.mode')
  const earn = to === 'earn'

  return (
    <Link
      href={MODE_HOME[to]}
      className={cn(
        'group block rounded-(--radius-card) border p-3 transition-colors',
        earn
          ? 'border-ink-200 bg-ink-50 hover:border-brand-600/45 hover:bg-brand-50'
          : 'border-violet-600/25 bg-violet-50 hover:border-violet-600/55',
        className,
      )}
    >
      <span
        className={cn(
          'flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.1em]',
          earn ? 'text-ink-400' : 'text-violet-700',
        )}
      >
        <ArrowLeftRight aria-hidden className="size-3.5" />
        {t('switchTo')}
      </span>
      <span className="mt-1.5 flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-900">
        {earn ? (
          <PlayCircle aria-hidden className="size-4 text-brand-700" />
        ) : (
          <Store aria-hidden className="size-4 text-violet-600" />
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
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5',
        'text-[0.75rem] font-semibold transition-colors',
        'pointer-coarse:py-2',
        earn
          ? 'border-ink-200 bg-surface text-ink-700 hover:border-brand-600/45 hover:text-brand-700'
          : 'border-violet-600/30 bg-violet-50 text-violet-700 hover:border-violet-600/60',
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
