import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { PeopleBoard } from '@/components/admin/PeopleBoard'
import { people } from '@/lib/admin/preview'

export const metadata: Metadata = { title: 'Admin · Messages', robots: { index: false, follow: false } }

/**
 * Messages — the operator's plan, literally: anybody who writes in appears in
 * the stacked layout, and selecting them opens the conversation beside it.
 * The chat itself is the chatbot they are supplying later; this is its seat.
 *
 * STILL PREVIEW, and the only one of the three people screens that is. Users
 * and Flagged went live on 2026-07-29; this one cannot, because there is no
 * message backend to be live against — a real account list with invented
 * messages against it would be worse than either. `live={false}` also keeps
 * these invented ids away from the server action.
 */
export default async function AdminMessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.messages')

  const threads = people().filter((p) => p.lastMessageAt)

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PeopleBoard people={threads} serverNow={Date.now()} mode="messages" live={false} />
    </>
  )
}
