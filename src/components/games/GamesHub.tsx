import { Gift, Ticket } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import type { GameStatus } from '@/lib/games/types'

/**
 * The games hub: what you can play and how many plays you have left.
 *
 * The play count lives here rather than on each game because there is ONE
 * shared pool across both games (operator's choice) — showing it per game
 * would imply two allowances.
 */
export async function GamesHub({ status }: { status: GameStatus }) {
  const t = await getTranslations('games')
  const format = await getFormatter()

  const games = [
    {
      href: '/games/mystery-box',
      key: 'box',
      Icon: Gift,
      from: '#7c3aed',
      to: '#c026d3',
    },
    {
      href: '/games/wheel',
      key: 'wheel',
      Icon: Ticket,
      from: '#0ea5e9',
      to: '#22c55e',
    },
  ] as const

  return (
    <div className="mx-auto w-full max-w-2xl px-1 pb-10 pt-2">
      <header className="animate-rise text-center">
        <h1 className="text-[1.5rem] font-bold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
        <p className="mt-1 text-[0.875rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {/* The allowance, stated once. */}
      <div
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className="animate-rise mt-5 flex items-center justify-between gap-4 rounded-(--radius-panel) border border-ink-200 bg-surface px-4 py-3.5"
      >
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-semibold text-ink-900">
            {t('playsLeft', { count: status.remaining })}
          </p>
          <p className="mt-0.5 text-[0.75rem] text-ink-500">
            {t('resetsOn', {
              date: format.dateTime(new Date(status.weekEndsAt), {
                weekday: 'long',
                day: 'numeric',
                month: 'short',
              }),
            })}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1.5 text-[1.125rem] font-bold tabular-nums text-brand-700">
          {status.remaining}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {games.map((game, index) => (
          <Link
            key={game.key}
            href={game.href}
            style={{ '--rise-delay': `${0.1 + index * 0.05}s` } as React.CSSProperties}
            className="animate-rise group relative overflow-hidden rounded-(--radius-panel) p-5 text-white shadow-md transition-transform hover:-translate-y-0.5"
          >
            <span
              aria-hidden
              className="absolute inset-0"
              style={{ background: `linear-gradient(135deg, ${game.from}, ${game.to})` }}
            />
            <span className="relative flex flex-col items-start gap-3">
              <game.Icon aria-hidden className="size-8" strokeWidth={2} />
              <span>
                <span className="block text-[1.0625rem] font-bold">{t(`${game.key}.name`)}</span>
                <span className="mt-0.5 block text-[0.8125rem] text-white/85">
                  {t(`${game.key}.tagline`)}
                </span>
              </span>
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-5 text-center text-[0.75rem] leading-relaxed text-ink-400">
        {t('fairness')}
      </p>
    </div>
  )
}
