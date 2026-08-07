import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { NotificationsView } from '@/components/notifications/NotificationsView'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getNotifications } from '@/lib/notifications/data'
import { serverNow } from '@/lib/server-now'

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
}

/**
 * The affiliate side's own notification list.
 *
 * ── WHY A SECOND PAGE AND NOT A SHARED ONE ──
 *
 * The list itself IS shared: `NotificationsView` is the same component, and
 * mark-read and clear are the same actions, because those operate on a row and
 * a row does not care which business it came from. What cannot be shared is
 * the READ — `getNotifications('affiliate')` returns this business's events
 * plus the account-wide ones, and nothing about points.
 *
 * It also has to live under `/market` so the page keeps the affiliate skin and
 * the affiliate bottom bar. The ads page renders inside the ads shell; linking
 * to it from here would drop somebody out of the mode to read a message about
 * the mode they just left.
 */
export default async function AffiliateNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('notifications')
  const notifications = await getNotifications('affiliate')

  return (
    <div className="relative isolate mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />
      <Link
        href="/market"
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('backToDashboard')}
      </Link>

      <NotificationsView notifications={notifications} now={serverNow()} variant="page" />
    </div>
  )
}
