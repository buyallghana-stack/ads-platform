'use client'

import { GraduationCap, LayoutGrid, Store, UserRound, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Logo } from '@/components/brand/Logo'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Navigation for the AFFILIATE mode.
 *
 * Same anatomy as `AppNav` — bottom tab bar under md, slim sidebar above it,
 * five destinations either way — because the two businesses share a login and
 * a person moving between them should not have to learn a second set of
 * gestures. What differs is the destinations and the skin, which is the whole
 * point: you can tell which business you are in without reading a word.
 *
 * ── THE FIVE, AND WHY THESE FIVE ──
 *
 *   Dashboard  /market       what you have earned and what to do next
 *   Products   /shop         what there is to promote
 *   Learn      /learn        the training, which is also the activation gate
 *   Earnings   /commission   the statement, and getting paid
 *   Account    /market/account   who you are here: code, tier, expiry
 *
 * The design reference has "Referrals" where Learn is. That was reassigned
 * deliberately. Training is not a side feature in this business — an affiliate
 * account does not switch on until the course is `activation_threshold_percent`
 * complete, so Learn is on the critical path for every single user, and a
 * recruit list is not: it is empty for everybody on the Beginner program, whose
 * commission depth is 1. The L2 network appears as a figure on the Dashboard
 * and a section inside Earnings, where it belongs to the money it explains.
 *
 * Five is the ceiling `AppNav` documents for a bottom bar, and this bar is at
 * it. A sixth destination goes behind one of these, not beside them.
 */

const DESTINATIONS = [
  { href: '/market', key: 'dashboard', Icon: LayoutGrid },
  { href: '/shop', key: 'products', Icon: Store },
  { href: '/learn', key: 'learn', Icon: GraduationCap },
  { href: '/commission', key: 'earnings', Icon: Wallet },
  { href: '/market/account', key: 'account', Icon: UserRound },
] as const

/**
 * Active by route prefix, so /shop/some-course still lights up Products.
 *
 * `/market` is the exception and has to match EXACTLY: every other tab's href
 * would otherwise be a prefix of nothing, but `/market/account` starts with
 * `/market`, so a prefix test lights Dashboard and Account at the same time.
 */
function useActive() {
  const pathname = usePathname()
  return (href: string) =>
    href === '/market'
      ? pathname === '/market'
      : pathname === href || pathname.startsWith(href + '/')
}

/** Fixed bottom tab bar. Rendered on every affiliate screen below md. */
export function AffiliateTabBar() {
  const t = useTranslations('affiliate.nav')
  const isActive = useActive()

  return (
    <nav
      aria-label={t('label')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-surface md:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="mx-auto flex max-w-md">
        {DESTINATIONS.map(({ href, key, Icon }) => {
          const active = isActive(href)
          return (
            <li key={key} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 pb-2 pt-2.5 text-[0.6875rem] font-medium transition-colors',
                  active ? 'text-brand-700' : 'text-ink-500 active:text-ink-800',
                )}
              >
                {/* The active tab gets a filled pill behind the glyph rather
                    than only a colour change. On a dark skin a hue shift alone
                    is the weakest of the available signals — the surrounding
                    contrast is already low, so there is little room for the
                    inactive colour to be far enough away. */}
                <span
                  className={cn(
                    'grid h-6 w-10 place-items-center rounded-full transition-colors',
                    active && 'bg-brand-50',
                  )}
                >
                  <Icon aria-hidden className="size-5" strokeWidth={active ? 2.4 : 2} />
                </span>
                {t(key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Slim sidebar for md+. The parent flex row reserves its column.
 *
 * `modeSlot` is the switch back to the ads business. It is passed in rather
 * than rendered here because the switch needs to know where it is going and
 * that is the layout's business, not the nav's.
 */
export function AffiliateSidebar({ modeSlot }: { modeSlot?: React.ReactNode }) {
  const t = useTranslations('affiliate.nav')
  const isActive = useActive()

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-ink-200 bg-surface px-3 py-5 md:flex xl:w-60">
      <div className="px-2">
        {/* `dark` is the two-tone wordmark — "Side" in ink-900, "Perks" in
            brand-600. Both tokens are remapped in here, so it comes out
            near-white and violet without the Logo knowing anything about the
            affiliate skin. The `light` variant is solid white and would lose
            the second colour. */}
        <Logo variant="dark" />
      </div>

      {/* Names the business, once, at the top of its own navigation. Without
          it the sidebar is five words that could belong to either half of the
          app — the skin says "somewhere else", this says where. */}
      <p className="mt-4 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-brand-700">
        {t('modeName')}
      </p>

      <nav aria-label={t('label')} className="mt-2 flex flex-1 flex-col">
        <ul className="flex flex-col gap-1">
          {DESTINATIONS.map(({ href, key, Icon }) => {
            const active = isActive(href)
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-(--radius-input) px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                  )}
                >
                  <Icon aria-hidden className="size-4.5" strokeWidth={active ? 2.2 : 2} />
                  {t(key)}
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="mt-auto flex flex-col gap-3">{modeSlot}</div>
      </nav>
    </aside>
  )
}
