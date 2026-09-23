import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Whether the member app is closed, and whether this person may still use it.
 *
 * ⚠️ READ WITH THE SERVICE CLIENT. `app_config`'s select policy is
 * `is_public OR is_admin()`, and both of these keys are private on purpose: an
 * allow list of addresses is not something to hand to every browser that loads
 * the page. Read through the user's client they come back null, which would
 * read as "maintenance off" and quietly do nothing.
 *
 * ⚠️ IT FAILS OPEN, DELIBERATELY. If the read itself fails the app stays
 * usable. The alternative is a database hiccup locking every member out of a
 * working product, which is a far worse outcome than a maintenance window that
 * starts a minute late.
 */
export async function getMaintenance(user: {
  id: string
  email?: string | null
}): Promise<{ closed: boolean }> {
  const admin = createAdminClient()

  const [{ data: config }, { data: role }] = await Promise.all([
    admin.from('app_config').select('key, value').in('key', ['maintenance_enabled', 'maintenance_allow_emails']),
    admin.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
  ])

  const enabled =
    config?.find((row) => row.key === 'maintenance_enabled')?.value === 'true'
  if (!enabled) return { closed: false }

  /* Staff always pass. Without this the switch could only ever be turned off
     by somebody with database access, because the admin area is reached
     through the same sign-in. */
  const STAFF = ['super_admin', 'admin', 'support', 'ads_manager']
  if (role?.role && STAFF.includes(role.role)) return { closed: false }

  const allowed = (config?.find((row) => row.key === 'maintenance_allow_emails')?.value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  const email = (user.email ?? '').trim().toLowerCase()
  if (email && allowed.includes(email)) return { closed: false }

  return { closed: true }
}
