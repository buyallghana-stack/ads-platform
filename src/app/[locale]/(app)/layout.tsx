import { getTranslations, setRequestLocale } from 'next-intl/server'

import { BottomTabBar, Sidebar } from '@/components/app/AppNav'
import { LogOutButton } from '@/components/app/LogOutButton'
import { Logo } from '@/components/brand/Logo'
import { Link } from '@/i18n/navigation'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Shell for every signed-in screen: Home, Ads, Upgrade, Profile.
 *
 * The auth check lives here rather than in each page — four protected routes
 * is past the point where per-page checks stay in sync.
 *
 * Chrome per breakpoint (operator decision, 2026-07-24):
 *   mobile   slim top bar (brand + log out) and a fixed bottom tab bar
 *   768px+   left sidebar carrying nav, the upgrade teaser and the user
 *            block — the arrangement both operator references share.
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

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('nav')
  const tDash = await getTranslations('dashboard')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user!.id)
    .maybeSingle()

  const displayName = profile?.full_name ?? user!.email ?? ''

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar
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
        userSlot={
          <div className="flex items-center justify-between gap-2 border-t border-ink-200 px-1 pt-3">
            <span className="min-w-0 truncate text-[0.75rem] text-ink-500" title={displayName}>
              {displayName}
            </span>
            <LogOutButton label={tDash('logOut')} />
          </div>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar. The sidebar carries the brand from md up. */}
        <header className="flex items-center justify-between border-b border-ink-200 bg-surface px-5 py-3 md:hidden">
          <Logo variant="dark" />
          <LogOutButton label={tDash('logOut')} />
        </header>

        {/* pb clears the fixed bottom tab bar on mobile. */}
        <main className="flex-1 pb-24 md:pb-0">{children}</main>
      </div>

      <BottomTabBar />
    </div>
  )
}
