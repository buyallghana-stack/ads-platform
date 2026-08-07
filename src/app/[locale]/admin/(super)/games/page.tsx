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

      {/* THE OTHER BUSINESS HAS ITS OWN GAMES AND ITS OWN PRIZE TABLE, paying
          cedis rather than points. The operator went looking for it here and
          did not find it (2026-08-07), because the only way in was a button on
          the affiliate withdrawals queue. This is that way in. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-ink-200 bg-ink-50 px-4 py-3">
        <p className="min-w-0 flex-1 text-[0.8125rem] text-ink-600">{t('affiliateNote')}</p>
        <Link
          href="/admin/affiliates/rewards"
          className="inline-flex shrink-0 items-center gap-2 rounded-(--radius-input) border border-ink-300 bg-surface px-3 py-2 text-[0.8125rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
        >
          {t('affiliateLink')}
        </Link>
      </div>

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

      {/*
        `key` is load-bearing, not decoration. Switching tabs is a client-side
        navigation, so React keeps the SAME editor instance and its
        `useState(prizes)` — which initialises once — went on holding the
        previous game's rows while the `game` prop changed underneath it.
        Saving then sent one game's prize ids under the other game's name.
        Keying on the game remounts the editor, which is the fix React
        actually intends here; an effect that copies props into state would
        trip react-hooks/set-state-in-effect and re-introduce a render where
        the two disagree.
      */}
      <GamePrizeEditor key={game} game={game} prizes={prizes} stats={stats} tiers={tiers} />
    </>
  )
}
