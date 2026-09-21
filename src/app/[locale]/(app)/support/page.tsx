import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { SupportChat } from '@/components/support/SupportChat'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { getSupportThread } from '@/lib/support/data'

import { markSupportRead } from './actions'

export const metadata: Metadata = {
  title: 'Support · SidePerks',
  robots: { index: false, follow: false },
}

/**
 * The person's conversation with support.
 *
 * Opening it marks the replies read — arriving IS reading them, and asking
 * somebody to press something to clear their own unread badge is busywork.
 * Done before the thread is rendered so the screen and the bell agree on the
 * same paint.
 */
export default async function SupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ about?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const { about } = await searchParams

  await markSupportRead()

  // The (app) layout has already guaranteed a session; both of these are
  // React-cached, so neither is a second round trip.
  const user = await getViewerUser()
  const [thread, profile] = await Promise.all([
    getSupportThread(),
    user ? getProfile(user.id) : null,
  ])

  return (
    <SupportChat
      messages={thread.messages}
      // Deliberate: a server component reading the clock trips
      // react-hooks/purity, and it is the accepted pattern here for handing a
      // stable `now` to a client component (dashboard, notifications,
      // sessions all do it). Seeding it in the browser is a hydration bug.
      now={Date.now()}
      about={about}
      user={{
        name: profile?.full_name ?? '',
      }}
    />
  )
}
