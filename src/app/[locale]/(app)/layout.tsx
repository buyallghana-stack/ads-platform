import { getTranslations, setRequestLocale } from 'next-intl/server'

import { BottomTabBar, Sidebar } from '@/components/app/AppNav'
import { Link } from '@/i18n/navigation'
import { redirect } from '@/i18n/navigation'
import { getProfile, getSessionUser, getViewerUser } from '@/lib/auth/session'
import { getViewAsSession } from '@/lib/admin/view-as'
import { ViewAsBanner } from '@/components/app/ViewAsBanner'
import { avatarPublicUrl } from '@/lib/profile/avatar'
import { needsLoginChallenge } from '@/lib/security/login-2fa'
import { getPlanStanding } from '@/lib/subscriptions/data'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

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

  const signedIn = await getSessionUser()
  if (!signedIn) redirect({ href: '/login', locale })

  const { data: deletionProfile } = await createAdminClient()
    .from('profiles')
    .select('deletion_requested_at, deleted_at')
    .eq('id', signedIn!.id)
    .maybeSingle()

  if (deletionProfile?.deletion_requested_at && !deletionProfile.deleted_at) {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect({ href: '/login', locale })
  }

  /*
    A session alone is not enough for an enrolled account. Supabase issues it
    on a correct password, so the second factor is enforced HERE — the one
    place every signed-in screen passes through — rather than at the login
    form, which a direct URL would simply skip.

    Checked against the SIGNED-IN account, never the one being viewed: a super
    admin looking at somebody's screens has already passed their own challenge,
    and asking for the target's second factor is both impossible and meaningless.
  */
  if (await needsLoginChallenge(signedIn!.id)) redirect({ href: '/verify-2fa', locale })

  /*
    From here down the layout renders the VIEWED account, which is the
    signed-in one unless a super admin has opened a look. Reads only — see
    `getViewerUser`.
  */
  const viewing = await getViewAsSession()
  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('nav')

  /*
    In parallel, because this layout runs on EVERY signed-in screen and the
    audience is on mobile data — two awaits in a row would add a round trip to
    every page for no reason.

    profile      cached alongside the page's own call, so the Profile tab
                 wearing the user's photo costs no extra query
    planStanding same rule as the Profile promo: "upgrade" only before they
                 own a plan, "add more" while some are left, and nothing at
                 all once they hold them every one
  */
  const [profile, planStanding] = await Promise.all([
    getProfile(user!.id),
    getPlanStanding(user!.id),
  ])
  const navUser = {
    avatarUrl: avatarPublicUrl(profile?.avatar_path),
    name: profile?.full_name ?? null,
  }

  return (
    /* The banner sits ABOVE the app shell rather than inside it, so the
       sidebar/content/tab-bar row below is byte-identical to what it was
       before "view as user" existed. Nothing about the normal signed-in
       layout changes when nobody is viewing. */
    <>
      {viewing && <ViewAsBanner name={profile?.full_name ?? t('viewAsFallbackName')} />}
      <div className="flex min-h-dvh bg-canvas">
      <Sidebar
        user={navUser}
        upgradeSlot={
          planStanding === 'all' ? null : (
            <Link
              href="/upgrade"
              className="block rounded-(--radius-card) border border-violet-600/20 bg-violet-50 p-3 transition-colors hover:border-violet-600/45"
            >
              <p className="text-[0.8125rem] font-semibold text-violet-700">
                {t(planStanding === 'some' ? 'addTeaserTitle' : 'upgradeTeaserTitle')}
              </p>
              <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-600">
                {t(planStanding === 'some' ? 'addTeaserBody' : 'upgradeTeaserBody')}
              </p>
            </Link>
          )
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* pb clears the fixed bottom tab bar on mobile. */}
        <main className="flex-1 pb-24 md:pb-0">{children}</main>
      </div>

      <BottomTabBar user={navUser} />
      </div>
    </>
  )
}
