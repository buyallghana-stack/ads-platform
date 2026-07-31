import { redirect } from '@/i18n/navigation'
import { areaAllowed, getAdminRole, homeForRole } from '@/lib/admin/roles'

/**
 * the message queue — open to a super admin and to the support role, nobody else.
 *
 * A layout rather than a check inside the page, for the same reason the
 * `(super)` group has one: the folder is what carries the permission, so a
 * second screen added to this area inherits it.
 */
export default async function AreaLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const role = await getAdminRole()

  if (!areaAllowed(role, 'support')) redirect({ href: homeForRole(role), locale })

  return <>{children}</>
}
