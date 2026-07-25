import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { AuditLog } from '@/components/admin/AuditLog'
import { auditEntries } from '@/lib/admin/preview'

export const metadata: Metadata = {
  title: 'Admin · Audit log',
  robots: { index: false, follow: false },
}

export default async function AdminAuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.audit')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {/* Date.now() in a Server Component is the repo's deliberate pattern for
          handing a stable clock to a client component — see payouts/page.tsx. */}
      <AuditLog entries={auditEntries()} serverNow={Date.now()} />
    </>
  )
}
