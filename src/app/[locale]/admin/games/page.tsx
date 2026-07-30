import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { GamePrizeEditor } from '@/components/admin/GamePrizeEditor'
import { Link } from '@/i18n/navigation'
import { getGamePrizes, getGameStats, getTierPlays } from '@/lib/admin/data/games'
import { cn } from '@/lib/cn'
import { GAME_KINDS, type GameKind } from '@/lib/games/types'

export const metadata: Metadata = {
  title: 'Admin · Games',
  robots: { index: false, follow: false },
}

const isGame = (value: unknown): value is GameKind => GAME_KINDS.includes(value as GameKind)

/**
 * Mystery box and spin the wheel: the prize tables and what they cost.
 *
 * The game is in the URL rather than in client state — an operator comparing
 * two economies wants two tabs open, and each board is a separate fetch of
 * twelve rows plus its statistics.
 */
export default async function AdminGamesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ game?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const { game: raw } = await searchParams
  const t = await getTranslations('admin.games')

  const game: GameKind = isGame(raw) ? raw : 'mystery_box'

  const [prizes, stats, tiers] = await Promise.all([
    getGamePrizes(game),
    getGameStats(game),
    getTierPlays(),
  ])

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <nav aria-label={t('gameTabs')} className="mb-4 flex gap-1 rounded-(--radius-input) bg-ink-100 p-1">
        {GAME_KINDS.map((key) => (
          <Link
            key={key}
            href={`/admin/games?game=${key}`}
            aria-current={key === game ? 'page' : undefined}
            className={cn(
              'flex-1 rounded-[calc(var(--radius-input)-0.25rem)] px-3 py-2 text-center',
              'text-[0.8125rem] font-semibold transition-colors',
              key === game
                ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                : 'text-ink-500 hover:text-ink-700',
            )}
          >
            {t(key === 'spin_wheel' ? 'wheel' : 'box')}
          </Link>
        ))}
      </nav>

      <GamePrizeEditor game={game} prizes={prizes} stats={stats} tiers={tiers} />
    </>
  )
}
