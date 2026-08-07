import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { GamesHub } from '@/components/games/GamesHub'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateGameStatus } from '@/lib/market/play'

export const metadata: Metadata = {
  title: 'Games',
  robots: { index: false, follow: false },
}

/**
 * The affiliate games hub.
 *
 * The SAME component as the ads hub, given the affiliate's allowance and a
 * different base path (operator, 2026-08-07: "perfectly copy the ads games and
 * leaderboard mechanism and display"). The first version of this screen was
 * two plain cards of my own, which is exactly the drift the shared component
 * prevents.
 *
 * Plays come from the training programme rather than an ads plan, which is the
 * only thing about the numbers that differs.
 */
export default async function AffiliateGamesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.games')
  const status = await getAffiliateGameStatus(user!.id)

  if (!status.enabled) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <Back label={t('back')} />
        <section className="mt-4 rounded-(--radius-panel) border border-ink-200 bg-surface p-6 text-center">
          <h1 className="text-[1rem] font-semibold text-ink-900">{t('closed.title')}</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-snug text-ink-500">
            {t('closed.body')}
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <Back label={t('back')} />
      <GamesHub
        hubHref="/market/games"
        status={{
          enabled: status.enabled,
          allowance: status.allowance,
          used: status.used,
          remaining: status.left,
          /* The hub prints when the allowance comes back. The week starts on
             Monday in `affiliate_week_start()`, so it ends seven days later. */
          weekEndsAt: new Date(
            new Date(`${status.weekStart}T00:00:00Z`).getTime() + 7 * 86_400_000,
          ).toISOString(),
        }}
      />
    </div>
  )
}

function Back({ label }: { label: string }) {
  return (
    <Link
      href="/market"
      className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {label}
    </Link>
  )
}
