import { getTranslations, setRequestLocale } from 'next-intl/server'

import { BottomTabBar, Sidebar } from '@/components/app/AppNav'
import { Link } from '@/i18n/navigation'
import { redirect } from '@/i18n/navigation'
import { getProfile, getSessionUser } from '@/lib/auth/session'
import { avatarPublicUrl } from '@/lib/profile/avatar'
import { needsLoginChallenge } from '@/lib/security/login-2fa'

/**
 * Shell for every signed-in screen: Home, Ads, Upgrade, Profile, Withdraw.
 *
 * The auth check lives here rather than in each page — several protected
 * routes is past the point where per-page checks stay in sync.
 *
 * Deliberately MINIMAL chrome (operator direction 2026-07-24): the header
 * with the brand, theme switch and logout belongs to the Home tab ONLY, so it
 * is not rendered here — the Home page renders its own. All this layout
 * provides everywhere is navigation: a bottom tab bar on mobile, a slim
 * sidebar (nav + upgrade teaser) on md+.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  /*
    A session alone is not enough for an enrolled account. Supabase issues it
    on a correct password, so the second factor is enforced HERE — the one
    place every signed-in screen passes through — rather than at the login
    form, which a direct URL would simply skip.
  */
  if (await needsLoginChallenge(user!.id)) redirect({ href: '/verify-2fa', locale })

  const t = await getTranslations('nav')

  // Cached alongside the page's own call, so the Profile tab wearing the
  // user's photo costs no extra query.
  const profile = await getProfile(user!.id)
  const navUser = {
    avatarUrl: avatarPublicUrl(profile?.avatar_path),
    name: profile?.full_name ?? null,
  }

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar
        user={navUser}
        upgradeSlot={
          <Link
            href="/upgrade"
            className="block rounded-(--radius-card) border border-violet-600/20 bg-violet-50 p-3 transition-colors hover:border-violet-600/45"
          >
            <p className="text-[0.8125rem] font-semibold text-violet-700">
              {t('upgradeTeaserTitle')}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-600">
              {t('upgradeTeaserBody')}
            </p>
          </Link>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* pb clears the fixed bottom tab bar on mobile. */}
        <main className="flex-1 pb-24 md:pb-0">{children}</main>
      </div>

      <BottomTabBar user={navUser} />
    </div>
  )
}
