import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LeaderboardView } from '@/components/leaderboard/LeaderboardView'
import { getSessionUser } from '@/lib/auth/session'
import { getLeaderboardData } from '@/lib/leaderboard/data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'leaderboard' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Leaderboard, reached from the shortcut row under the balance.
 *
 * Rendered per request and never cached: a rank people compete over must not
 * be a minute stale, and two users comparing screens is exactly the situation
 * a cache would embarrass. The auth guard lives in `(app)/layout.tsx`.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) return null

  const data = await getLeaderboardData(user.id)

  return <LeaderboardView data={data} />
}
