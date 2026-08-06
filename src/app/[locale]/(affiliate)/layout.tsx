import { setRequestLocale } from 'next-intl/server'

import { AffiliateSidebar, AffiliateTabBar } from '@/components/affiliate/AffiliateNav'
import { ModeSwitchCard } from '@/components/app/ModeSwitch'
import { ViewAsBanner } from '@/components/app/ViewAsBanner'
import { redirect } from '@/i18n/navigation'
import { getViewAsSession } from '@/lib/admin/view-as'
import { getProfile, getSessionUser, getViewerUser } from '@/lib/auth/session'
import { needsLoginChallenge } from '@/lib/security/login-2fa'

/**
 * Shell for the AFFILIATE mode — every Phase 2 screen.
 *
 * ── THE SKIN IS MOUNTED HERE AND NOWHERE ELSE ──
 *
 * `.affiliate` on this one wrapper redefines the semantic colour tokens for
 * everything beneath it (see globals.css). That is the entire second design
 * system: no parallel components, no per-screen theme prop, nothing for a new
 * page to remember to opt into. Put a screen in this route group and it is
 * violet-dark; take it out and it is not.
 *
 * It also means the skin cannot leak. A token block scoped to a subtree ends
 * where the subtree ends, so the ads business is unreachable from here by
 * construction rather than by discipline.
 *
 * ⚠️ Inside this tree, never use a `dark:` utility. It keys off the class on
 * <html>, which reports the USER'S theme, not this subtree's — in light mode
 * it silently does nothing and the element renders light-on-dark. Tokens are
 * the only thing that knows where it is.
 *
 * The auth gate is a duplicate of `(app)/layout.tsx`'s by necessity: route
 * groups are siblings, so this tree does not pass through that layout and a
 * check there protects nothing here. The two must not drift — a second factor
 * enforced on one business and not the other is a way in.
 */
export default async function AffiliateLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const signedIn = await getSessionUser()
  if (!signedIn) redirect({ href: '/login', locale })

  /* Checked against the SIGNED-IN account, never the one being viewed — a
     super admin looking at somebody's screens has already passed their own
     challenge, and asking for the target's second factor is meaningless. */
  if (await needsLoginChallenge(signedIn!.id)) redirect({ href: '/verify-2fa', locale })

  const viewing = await getViewAsSession()
  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const profile = viewing ? await getProfile(user!.id) : null

  return (
    <>
      {viewing && <ViewAsBanner name={profile?.full_name ?? 'this user'} />}
      <div className="affiliate flex min-h-dvh bg-canvas text-ink-900">
        <AffiliateSidebar modeSlot={<ModeSwitchCard to="earn" />} />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* pb clears the fixed bottom tab bar on mobile. */}
          <main className="flex-1 pb-24 md:pb-0">{children}</main>
        </div>

        <AffiliateTabBar />
      </div>
    </>
  )
}
