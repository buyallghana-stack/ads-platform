import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { Planned, PlannedNote } from '@/components/admin/Planned'

export const metadata: Metadata = {
  title: 'Admin · Audit',
  robots: { index: false, follow: false },
}

/**
 * Audit — screen not built yet, scope written down.
 *
 * Listed rather than hidden so the operator can point at a line and say
 * "build that next", the way the Profile hub was worked through.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.audit')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PlannedNote ready={true}>{t('note')}</PlannedNote>
      <Planned
        items={[
          { title: 'Action log', body: 'Who changed what, when, with the before and after values.', backend: 'admin_audit_log' },
          { title: 'Filter by actor', body: 'Everything one administrator has done.', backend: 'admin_audit_log.actor_id' },
          { title: 'Filter by record', body: 'Everything that has happened to one ad, user or setting.' },
          { title: 'Payout decisions', body: 'Approvals, rejections and disputes with the reason given.', backend: 'redemptions.decided_by' },
          { title: 'System alerts', body: 'Ceiling breaches and other automatic warnings.', backend: 'system_alerts' },
        ]}
      />
    </>
  )
}
