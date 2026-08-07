import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { AffiliateRewards } from '@/components/admin/AffiliateRewards'
import { Link } from '@/i18n/navigation'
import {
  AFFILIATE_GAMES,
  getAffiliateAdminTasks,
  getAffiliatePrizes,
  type AffiliateGame,
} from '@/lib/admin/data/affiliate-rewards'
import { getPlatformConfig } from '@/lib/admin/data/config'

export const metadata: Metadata = {
  title: 'Admin · Affiliate rewards',
  robots: { index: false, follow: false },
}

const isGame = (v: string | undefined): v is AffiliateGame =>
  AFFILIATE_GAMES.includes(v as AffiliateGame)

/**
 * What the affiliate games and tasks pay.
 *
 * Everything shipped on 2026-08-07 was inert without this: five tasks paying
 * nothing and a prize table of placeholder amounts, changeable only in SQL.
 *
 * Sits under Affiliates rather than beside the points games, because these
 * pay CEDIS and those pay points, and two screens that look identical while
 * spending different money is exactly the confusion D27 exists to prevent.
 */
export default async function AdminAffiliateRewardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ game?: string }>
}) {
  const { locale } = await params
  const { game: raw } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('admin.affiliateRewards')

  const game: AffiliateGame = isGame(raw) ? raw : 'mystery_box'

  const [prizes, tasks, config] = await Promise.all([
    getAffiliatePrizes(game),
    getAffiliateAdminTasks(),
    getPlatformConfig(),
  ])

  const gamesOn = config.values.affiliate_games_enabled === true

  return (
    <>
      <Link
        href="/admin/affiliates"
        className="mb-3 inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <PageHeader title={t('title')} description={t('description')} />

      {/* Said once, at the top: the prize table is live or it is not, and an
          operator tuning weights should know which. */}
      <p
        className={
          gamesOn
            ? 'mb-4 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 px-4 py-3 text-[0.8125rem] leading-snug text-ink-800'
            : 'mb-4 rounded-(--radius-card) border border-ink-200 bg-ink-50 px-4 py-3 text-[0.8125rem] leading-snug text-ink-600'
        }
      >
        {gamesOn ? t('gamesOn') : t('gamesOff')}
      </p>

      <AffiliateRewards game={game} prizes={prizes} tasks={tasks} />
    </>
  )
}
