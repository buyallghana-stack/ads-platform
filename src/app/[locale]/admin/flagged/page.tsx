import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PeopleBoard } from '@/components/admin/PeopleBoard'
import { people } from '@/lib/admin/preview'

export const metadata: Metadata = { title: 'Admin · Flagged', robots: { index: false, follow: false } }

/**
 * Flagged accounts — the same stacked layout as Users, filtered to the ones
 * the system or the operator has raised. The operator asked for exactly that
 * inheritance: one way to look at a person, whatever brought you to them.
 */
export default async function AdminFlaggedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.flagged')

  const flagged = people().filter((p) => p.status === 'flagged' || p.status === 'disabled')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PeopleBoard people={flagged} serverNow={Date.now()}
        mode="flagged" />
    </>
  )
}
