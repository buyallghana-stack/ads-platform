import { redirect } from '@/i18n/navigation'
import { getAdminRole, homeForRole } from '@/lib/admin/roles'

/**
 * Everything only a super admin may see.
 *
 * The guard is the FOLDER, not a line somebody remembers to write. Every
 * screen under `(super)` — payouts, finance, plans, people, gift codes, games,
 * tasks, settings, the audit trail and the overview — is covered by this one
 * layout, and a screen added here tomorrow is covered on the day it is
 * created. That is the same reasoning the parent layout gives for putting the
 * admin check in one place instead of on page fourteen, applied one level
 * down. `(super)` is a route group, so it appears in no URL.
 *
 * Support and ads managers are not shown a refusal, they are sent to the part
 * of the console that IS theirs. Being told "forbidden" by a screen you had no
 * reason to expect to exist is a worse experience than simply arriving
 * somewhere useful, and it confirms the screen exists.
 */
export default async function SuperAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const role = await getAdminRole()

  if (role !== 'super_admin') redirect({ href: homeForRole(role), locale })

  return <>{children}</>
}
