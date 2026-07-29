import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PeopleBoard } from '@/components/admin/PeopleBoard'
import { getPeople } from '@/lib/admin/data/people'

export const metadata: Metadata = { title: 'Admin · Flagged', robots: { index: false, follow: false } }

/**
 * Flagged accounts — the same stacked layout as Users, filtered to the ones
 * the system or the operator has raised. The operator asked for exactly that
 * inheritance: one way to look at a person, whatever brought you to them.
 *
 * The filter is the database's, not the browser's. `admin_list_people` takes
 * the scope, so this screen fetches six accounts rather than every account
 * and hiding the rest — which is the same list today and a very different
 * one at ten thousand users.
 */
export default async function AdminFlaggedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.flagged')

  const flagged = await getPeople('flagged')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PeopleBoard people={flagged} serverNow={Date.now()} mode="flagged" />
    </>
  )
}
