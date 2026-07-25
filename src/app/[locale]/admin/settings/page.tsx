import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { Planned, PlannedNote } from '@/components/admin/Planned'

export const metadata: Metadata = {
  title: 'Admin · Settings',
  robots: { index: false, follow: false },
}

/**
 * Settings — screen not built yet, scope written down.
 *
 * Listed rather than hidden so the operator can point at a line and say
 * "build that next", the way the Profile hub was worked through.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.settings')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PlannedNote ready={false}>{t('note')}</PlannedNote>
      <Planned
        items={[
          { title: 'Administrators', body: 'Who has the admin role, and granting or revoking it.', backend: 'user_roles' },
          { title: 'Require two-factor', body: 'Force every administrator to enrol an authenticator. Worth doing before payouts go live.', backend: 'user_security' },
          { title: 'Notification preferences', body: 'Which events should reach the operator, and how.' },
          { title: 'Appearance', body: 'Light, dark or system for the admin area.' },
          { title: 'Session management', body: 'Where administrators are signed in, and revoking a device.', backend: 'get_active_sessions()' },
        ]}
      />
    </>
  )
}
