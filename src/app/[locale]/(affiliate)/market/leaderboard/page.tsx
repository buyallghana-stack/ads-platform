import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LeaderboardView } from '@/components/leaderboard/LeaderboardView'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateLeaderboardData } from '@/lib/market/play'

export const metadata: Metadata = {
  title: 'Earnings board',
  robots: { index: false, follow: false },
}

/**
 * The affiliate earnings board.
 *
 * The SAME view as the points leaderboard (operator, 2026-08-07: "perfectly
 * copy the ads games and leaderboard mechanism and display"). Same podium,
 * same medals, same movement arrows, same jump-to-me button, same four
 * periods. The only difference is the unit: cleared commission in cedis rather
 * than points, which the two format functions below supply.
 *
 * The first version of this screen was a board of my own design. Sharing the
 * component is what stops the two drifting apart again.
 *
 * Rendered per request and never cached, for the same reason the points board
 * is not: a rank people compete over must not be a minute stale.
 */
export default async function AffiliateLeaderboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.board')
  const data = await getAffiliateLeaderboardData(user!.id)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <Link
        href="/market"
        className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <LeaderboardView data={data} unit="money" />
    </div>
  )
}
