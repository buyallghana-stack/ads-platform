import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PeopleBoard } from '@/components/admin/PeopleBoard'
import { getPeople } from '@/lib/admin/data/people'

export const metadata: Metadata = { title: 'Admin · Messages', robots: { index: false, follow: false } }

/**
 * Messages — the operator's plan, literally: anybody who writes in appears in
 * the stacked layout, and selecting them opens the conversation beside it.
 *
 * REAL AS OF 2026-07-29, and the last screen in the admin area to come off
 * preview data. The `messages` scope is applied in SQL: the list is the people
 * who have actually written, not every account with the rest hidden.
 */
export default async function AdminMessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.messages')

  const threads = await getPeople('messages')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {/* Deliberate clock read in a server component — the accepted pattern
          here for handing a stable `now` to a client component. */}
      <PeopleBoard people={threads} serverNow={Date.now()} mode="messages" live />
    </>
  )
}
