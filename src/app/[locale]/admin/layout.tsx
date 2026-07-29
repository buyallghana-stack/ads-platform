import { setRequestLocale } from 'next-intl/server'

import { AdminRail, AdminSidebar } from '@/components/admin/AdminNav'
import { AdminTopBar } from '@/components/admin/AdminChrome'
import { redirect } from '@/i18n/navigation'
import { getProfile, getSessionUser } from '@/lib/auth/session'
import { countPayoutsAwaitingDecision } from '@/lib/admin/data/payouts'
import { PREVIEW, people } from '@/lib/admin/preview'
import { needsLoginChallenge } from '@/lib/security/login-2fa'
import { createClient } from '@/lib/supabase/server'

/**
 * Shell for every admin screen.
 *
 * The role check lives HERE, in the one place every admin route passes
 * through, for the same reason the two-factor check lives in the user
 * layout: a per-page check is a check somebody forgets to add to page
 * fourteen. A non-admin is sent to the user dashboard rather than shown a
 * "forbidden" screen — the existence of an admin area is not something a
 * signed-in stranger needs confirmed.
 *
 * `is_admin()` is asked of the DATABASE through the user's own client, so the
 * answer comes from the same RLS predicate that guards every admin table. A
 * claim in a cookie or a role cached in a session would be a second source of
 * truth, and the wrong one to trust.
 */
export default async function AdminLayout({
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

  // An enrolled account must clear its second factor before anything else,
  // and an admin approving payouts is exactly who that is for.
  if (await needsLoginChallenge(user!.id)) redirect({ href: '/verify-2fa', locale })

  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) redirect({ href: '/dashboard', locale })

  const profile = await getProfile(user!.id)

  /*
    Queue depths on the nav. These are the numbers that tell the operator
    where the work is before they click anything, so they are computed here
    once rather than on each screen.

    Payouts is real as of 2026-07-28; messages and flagged are still preview
    and stay that way until their screens are wired. A badge is a promise that
    there is work behind it, so the two that are still invented must not be
    left to look like the one that is not — the top bar's data badge is what
    says which is which.
  */
  const everyone = people()
  const counts = {
    payouts: await countPayoutsAwaitingDecision(),
    messages: everyone.reduce((n, p) => n + (p.unread ?? 0), 0),
    flagged: everyone.filter((p) => p.status === 'flagged' || p.status === 'disabled').length,
  }

  const admin = {
    name: profile?.full_name ?? user!.email ?? 'Admin',
    email: user!.email ?? '',
  }

  return (
    <div className="flex min-h-dvh bg-canvas">
      <AdminSidebar counts={counts} admin={admin} />
      <AdminRail counts={counts} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopBar counts={counts} admin={admin} preview={PREVIEW} />
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
