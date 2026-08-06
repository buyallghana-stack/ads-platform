'use client'

import { Gem, House, PlayCircle, UserRound, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Logo } from '@/components/brand/Logo'
import { Avatar } from '@/components/profile/Avatar'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

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

const DESTINATIONS = [
  { href: '/dashboard', key: 'home', Icon: House },
  { href: '/ads', key: 'ads', Icon: PlayCircle },
  { href: '/upgrade', key: 'upgrade', Icon: Gem },
  { href: '/team', key: 'team', Icon: Users },
  { href: '/profile', key: 'profile', Icon: UserRound },
] as const

function useActive() {
  const pathname = usePathname()
  return (href: string) => pathname === href || pathname.startsWith(href + '/')
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
  className,
}: {
  avatarUrl: string | null
  name: string | null
  active: boolean
  className: string
}) {
  if (!avatarUrl) {
    return <UserRound aria-hidden className={className} strokeWidth={active ? 2.4 : 2} />
  }
  return (
    <Avatar
      name={name}
      src={avatarUrl}
      className={cn(className, active && 'ring-2 ring-brand-600')}
    />
  )
}

/** What the nav needs to know about the signed-in user. */
export type NavUser = { avatarUrl: string | null; name: string | null }

/** Fixed bottom tab bar. Rendered on every app screen below md. */
export function BottomTabBar({ user }: { user?: NavUser }) {
  const t = useTranslations('nav')
  const isActive = useActive()

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
        {DESTINATIONS.map(({ href, key, Icon }) => {
          const active = isActive(href)
          return (
            <li key={key} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 pb-2 pt-2.5 text-[0.6875rem] font-medium',
                  'transition-colors',
                  active ? 'text-brand-600' : 'text-ink-500 active:text-ink-700',
                )}
              >
                {key === 'profile' ? (
                  <ProfileGlyph
                    avatarUrl={user?.avatarUrl ?? null}
                    name={user?.name ?? null}
                    active={active}
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
  modeSlot,
  user,
}: {
  /** Upgrade teaser card, pinned to the bottom like the references. */
  upgradeSlot?: React.ReactNode
  /** The door into the affiliate business. Pinned under the teaser, and
   *  mirrored into the Home header for phones — the sidebar is `md:flex`, so
   *  this slot alone would leave the second business unreachable on a phone,
   *  which is exactly the bug the first version of the mode switch shipped. */
  modeSlot?: React.ReactNode
  user?: NavUser
}) {
  const t = useTranslations('nav')
  const isActive = useActive()

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-ink-200 bg-surface px-3 py-5 md:flex xl:w-60">
      <div className="px-2">
        <Logo variant="dark" />
      </div>

      <nav aria-label={t('label')} className="mt-7 flex flex-1 flex-col">
        <ul className="flex flex-col gap-1">
          {DESTINATIONS.map(({ href, key, Icon }) => {
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
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                  )}
                >
                  {key === 'profile' ? (
                    <ProfileGlyph
                      avatarUrl={user?.avatarUrl ?? null}
                      name={user?.name ?? null}
                      active={active}
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

        <div className="mt-auto flex flex-col gap-3">
          {upgradeSlot}
          {modeSlot}
        </div>
      </nav>
    </aside>
  )
}
