'use client'

import {
  Gem,
  GraduationCap,
  House,
  LayoutGrid,
  Link2,
  PlayCircle,
  Store,
  UserRound,
  Users,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Logo } from '@/components/brand/Logo'
import { ModeSwitch } from '@/components/app/ModeSwitch'
import { Avatar } from '@/components/profile/Avatar'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import { type AppMode, modeForPath } from '@/lib/market/mode'

/**
 * App navigation, one component per breakpoint convention (2026-07-24
 * decision):
 *
 *   mobile  (<768px)  Fixed bottom tab bar — thumb-reach placement, the
 *                     pattern both platform HIGs recommend for 3–5 primary
 *                     destinations. Safe-area padding for gesture-nav phones.
 *   768px+            Slim left sidebar, per the operator's two references.
 *
 * Same five destinations either way, so muscle memory transfers between a
 * phone and a laptop. Active state is by route prefix, not equality, so
 * /profile/payout-details still lights up Profile.
 *
 * FIVE, since 2026-07-31: Team was added between Upgrade and Profile at the
 * operator's instruction. Five is the ceiling both platform guidelines give
 * for a bottom bar and it is now reached — a sixth destination belongs behind
 * one of these, not beside them. The labels still fit because the bar divides
 * evenly and the longest of them ("Upgrade") is seven characters at 11px; a
 * longer word in either language is the thing to check before adding another.
 */

/*
  TWO SETS, since 2026-08-06. Phase 2 is a second business, and the note above
  is the reason it could not simply be a sixth tab: five is the ceiling and the
  bar was already at it. Rather than demote an ads destination to make room for
  a whole other business, each business gets its own five and the ModeSwitch
  moves between them. See src/lib/market/mode.ts for the full reasoning.

  Both sets end with Profile in the same slot, because the account is shared
  and its position should not move under the thumb when the mode changes.
  Everything before it differs, so nothing else is in a misleading place.
*/
const DESTINATIONS: Record<AppMode, ReadonlyArray<{ href: string; key: string; Icon: typeof House }>> =
  {
    earn: [
      { href: '/dashboard', key: 'home', Icon: House },
      { href: '/ads', key: 'ads', Icon: PlayCircle },
      { href: '/upgrade', key: 'upgrade', Icon: Gem },
      { href: '/team', key: 'team', Icon: Users },
      { href: '/profile', key: 'profile', Icon: UserRound },
    ],
    market: [
      { href: '/market', key: 'marketHome', Icon: LayoutGrid },
      { href: '/shop', key: 'shop', Icon: Store },
      { href: '/learn', key: 'learn', Icon: GraduationCap },
      { href: '/links', key: 'links', Icon: Link2 },
      { href: '/profile', key: 'profile', Icon: UserRound },
    ],
  }

function useActive() {
  const pathname = usePathname()
  return (href: string) => pathname === href || pathname.startsWith(href + '/')
}

/*
  The lit colour is the MODE's colour, not a fixed brand blue — it is the one
  place the two businesses are told apart at a glance while you are inside one
  of them. Jade is identity here, never status; see globals.css.
*/
const ACTIVE_TEXT: Record<AppMode, string> = {
  earn: 'text-brand-600',
  market: 'text-jade-700',
}

const ACTIVE_RAIL: Record<AppMode, string> = {
  earn: 'bg-brand-50 text-brand-700',
  market: 'bg-jade-50 text-jade-700',
}

const ACTIVE_RING: Record<AppMode, string> = {
  earn: 'ring-brand-600',
  market: 'ring-jade-600',
}

/**
 * The user's own face is a better Profile affordance than a generic figure —
 * it is how every app the audience already uses marks "you". So once a photo
 * is set, the Profile tab wears it; without one we keep the outline icon
 * (initials at 20px would be cramped, and the icon is the honest empty state).
 *
 * The active photo gets a ring, because the thicker-stroke trick the icons use
 * to read as "on" does nothing to a photograph.
 */
function ProfileGlyph({
  avatarUrl,
  name,
  active,
  mode,
  className,
}: {
  avatarUrl: string | null
  name: string | null
  active: boolean
  mode: AppMode
  className: string
}) {
  if (!avatarUrl) {
    return <UserRound aria-hidden className={className} strokeWidth={active ? 2.4 : 2} />
  }
  return (
    <Avatar
      name={name}
      src={avatarUrl}
      className={cn(className, active && ['ring-2', ACTIVE_RING[mode]])}
    />
  )
}

/** What the nav needs to know about the signed-in user. */
export type NavUser = { avatarUrl: string | null; name: string | null }

/** Fixed bottom tab bar. Rendered on every app screen below md. */
export function BottomTabBar({ user }: { user?: NavUser }) {
  const t = useTranslations('nav')
  const isActive = useActive()
  const mode = modeForPath(usePathname())

  return (
    <nav
      aria-label={t('label')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-surface md:hidden',
        // Gesture-nav phones reserve space below the bar; without this the
        // tabs sit under the home indicator.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="mx-auto flex max-w-md">
        {DESTINATIONS[mode].map(({ href, key, Icon }) => {
          const active = isActive(href)
          return (
            <li key={key} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 pb-2 pt-2.5 text-[0.6875rem] font-medium',
                  'transition-colors',
                  active ? ACTIVE_TEXT[mode] : 'text-ink-500 active:text-ink-700',
                )}
              >
                {key === 'profile' ? (
                  <ProfileGlyph
                    avatarUrl={user?.avatarUrl ?? null}
                    name={user?.name ?? null}
                    active={active}
                    mode={mode}
                    className="size-5"
                  />
                ) : (
                  <Icon
                    aria-hidden
                    className="size-5"
                    // Filled-feel weight on the active tab without a second
                    // icon set: thicker stroke reads as "on" at this size.
                    strokeWidth={active ? 2.4 : 2}
                  />
                )}
                {t(key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Slim sidebar for md+. The parent grid reserves its column.
 *
 *  Carries only navigation and the upgrade teaser. The brand logo anchors the
 *  nav; the theme switch and logout live in the Home header, not here
 *  (operator direction 2026-07-24: that chrome is Home-only). */
export function Sidebar({
  upgradeSlot,
  user,
}: {
  /** Upgrade teaser card, pinned to the bottom like the references. */
  upgradeSlot?: React.ReactNode
  user?: NavUser
}) {
  const t = useTranslations('nav')
  const isActive = useActive()
  const mode = modeForPath(usePathname())

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-ink-200 bg-surface px-3 py-5 md:flex xl:w-60">
      <div className="px-2">
        <Logo variant="dark" />
      </div>

      {/* Directly under the brand, above the destinations it governs — the
          reading order matches the hierarchy: which business, then where in
          it. On a phone there is nowhere to put this (the bar is full and
          there is no global header), so the switch lives in each mode's
          dashboard header instead. */}
      <ModeSwitch className="mt-5" />

      <nav aria-label={t('label')} className="mt-6 flex flex-1 flex-col">
        <ul className="flex flex-col gap-1">
          {DESTINATIONS[mode].map(({ href, key, Icon }) => {
            const active = isActive(href)
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-(--radius-input) px-3 py-2 text-sm font-medium',
                    'transition-colors',
                    active
                      ? ACTIVE_RAIL[mode]
                      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                  )}
                >
                  {key === 'profile' ? (
                    <ProfileGlyph
                      avatarUrl={user?.avatarUrl ?? null}
                      name={user?.name ?? null}
                      active={active}
                      mode={mode}
                      className="size-4.5"
                    />
                  ) : (
                    <Icon aria-hidden className="size-4.5" strokeWidth={active ? 2.2 : 2} />
                  )}
                  {t(key)}
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Earn mode only. The teaser sells an ADS plan, and offering one at
            the foot of the affiliate navigation would be the exact confusion
            the two modes exist to prevent. */}
        <div className="mt-auto flex flex-col gap-3">{mode === 'earn' && upgradeSlot}</div>
      </nav>
    </aside>
  )
}
