import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { NotificationsView } from '@/components/notifications/NotificationsView'
import { Card } from '@/components/ui/Card'
import { Link, redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { getNotifications } from '@/lib/notifications/data'

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
}

/**
 * Full notifications page — the phone experience (the bell links here) and the
 * "See All" target from the desktop panel. Same tabbed feed as the panel, in a
 * contained card, with a back route to Home.
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('notifications')
  const notifications = await getNotifications()
  const now = Date.now()

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 md:py-7">
      <header className="flex items-center gap-3">
        <Link
          href="/dashboard"
          aria-label={t('back')}
          className="grid size-9 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-10"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
      </header>

      <Card className="animate-rise mt-4">
        <NotificationsView notifications={notifications} now={now} variant="page" />
      </Card>
    </div>
  )
}
