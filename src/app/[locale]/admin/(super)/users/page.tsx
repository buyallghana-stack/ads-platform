import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PeopleBoard } from '@/components/admin/PeopleBoard'
import { getPeople } from '@/lib/admin/data/people'

export const metadata: Metadata = { title: 'Admin · Users', robots: { index: false, follow: false } }

export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.users')

  const people = await getPeople('all')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {/* Date.now() in a Server Component is the repo's deliberate pattern for
          handing a stable clock to a client component — see payouts/page.tsx. */}
      <PeopleBoard people={people} serverNow={Date.now()} mode="users" />
    </>
  )
}
