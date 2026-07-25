import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PeopleBoard } from '@/components/admin/PeopleBoard'
import { people } from '@/lib/admin/preview'

export const metadata: Metadata = { title: 'Admin · Users', robots: { index: false, follow: false } }

export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.users')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PeopleBoard people={people()} serverNow={Date.now()}
        mode="users" />
    </>
  )
}
