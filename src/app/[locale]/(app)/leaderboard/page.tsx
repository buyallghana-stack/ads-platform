import type { Metadata } from 'next'

import { Trophy } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LeaderboardView } from '@/components/leaderboard/LeaderboardView'
import { Card } from '@/components/ui/Card'
import { getViewerUser } from '@/lib/auth/session'
import { getLeaderboardData, getLeaderboardEnabled } from '@/lib/leaderboard/data'

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

  const user = await getViewerUser()
  if (!user) return null

  const t = await getTranslations('leaderboard')

  /* Checked before the data fetch, not after: `get_leaderboard` /
     `get_leaderboard_standing` now refuse server-side when this is off, and
     calling them anyway would just mean discarding two RPCs' worth of error
     responses instead of one config read. */
  const enabled = await getLeaderboardEnabled()
  if (!enabled) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span
          aria-hidden
          className="grid size-12 place-items-center rounded-full border border-ink-200 bg-ink-50 text-ink-300"
        >
          <Trophy className="size-5" />
        </span>
        <p className="max-w-xs text-[0.9375rem] font-medium text-ink-700">{t('unavailable')}</p>
      </Card>
    )
  }

  const data = await getLeaderboardData(user.id)

  return <LeaderboardView data={data} />
}
