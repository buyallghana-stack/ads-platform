import { setRequestLocale } from 'next-intl/server'
import { getTranslations } from 'next-intl/server'

import { BottomTabBar, Sidebar } from '@/components/app/AppNav'
import { Logo } from '@/components/brand/Logo'
import { Link } from '@/i18n/navigation'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { avatarPublicUrl } from '@/lib/profile/avatar'

/**
 * The shop, for people who are not signed in as much as for people who are.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LIVES OUTSIDE `(app)`
 *
 * An affiliate link is `/shop/<slug>?ref=<code>` and it is sent to STRANGERS —
 * that is the entire point of an affiliate programme. While the shop sat inside
 * the authenticated route group, following one bounced the visitor to a login
 * page before they saw a single word about what they were being asked to buy.
 *
 * Attribution survived that (the click and the cookie are both recorded before
 * the redirect), so no money was lost. But asking somebody to create an account
 * to find out what you are selling is the shortest possible route to them not
 * finding out.
 *
 * ---------------------------------------------------------------------------
 * ONE PAGE, TWO SHELLS
 *
 * Moving it out must not cost signed-in users their navigation, so this layout
 * renders the app chrome when there is somebody to render it for and a slim
 * public header when there is not. The pages themselves do not know or care.
 *
 * There is no auth REDIRECT here — that is the whole change. `getViewerUser`
 * returning null is a normal state on these routes, not a failure.
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  const t = await getTranslations('common')

  if (!user) {
    return (
      <div className="flex min-h-dvh flex-col bg-canvas">
        <header className="border-b border-ink-200 bg-surface">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 md:px-8">
            <Link href="/">
              <Logo variant="dark" />
            </Link>
            {/* Sign in rather than sign up: somebody arriving on an affiliate
                link is more often a returning visitor than a new one, and the
                buy button handles the new-account case itself with the product
                they wanted in hand. */}
            <Link
              href="/login"
              className="rounded-(--radius-input) border border-ink-200 px-3.5 py-1.5 text-[0.8125rem] font-semibold text-ink-800 transition-colors hover:border-ink-300"
            >
              {t('logIn')}
            </Link>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    )
  }

  const profile = await getProfile(user.id)
  const navUser = {
    avatarUrl: avatarPublicUrl(profile?.avatar_path),
    name: profile?.full_name ?? null,
  }

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar user={navUser} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* pb clears the fixed bottom tab bar on mobile, same as the app shell. */}
        <main className="flex-1 pb-24 md:pb-0">{children}</main>
      </div>
      <BottomTabBar user={navUser} />
    </div>
  )
}
