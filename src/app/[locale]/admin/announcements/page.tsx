import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { AnnouncementComposer } from '@/components/admin/AnnouncementComposer'
import { getAnnouncements, getAudienceSize } from '@/lib/admin/data/announcements'

export const metadata: Metadata = {
  title: 'Admin · Announcements',
  robots: { index: false, follow: false },
}

/**
 * One message to everybody.
 *
 * `broadcast_notification` had existed since the notifications work with no
 * screen calling it. This is that screen, plus the two things the primitive
 * could not do on its own: assert who is sending, and remember what was sent.
 */
export default async function AdminAnnouncementsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.announcements')

  // In parallel: this screen is two independent reads and neither gates the
  // other.
  const [audience, history] = await Promise.all([getAudienceSize(), getAnnouncements()])

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {/* Deliberate clock read in a server component — the accepted pattern
          here for handing a stable `now` to a client component. */}
      <AnnouncementComposer audience={audience} history={history} now={Date.now()} />
    </>
  )
}
