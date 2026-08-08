import { ArrowRight, Gift, Lock, Ticket } from 'lucide-react'
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
export async function GamesHub({
  status,
  hubHref = '/games',
  upgradeHref = '/upgrade',
  via = 'plan',
}: {
  status: GameStatus
  /**
   * Which business's hub this is. The affiliate side renders the same two
   * cards, the same allowance strip and the same fairness note; only the
   * destinations differ, because a hub that looked different would be the
   * first place the two games started drifting apart.
   */
  hubHref?: string
  /** Where plays are bought. A plan on the ads side, a programme on the other. */
  upgradeHref?: string
  /** Which of those two this hub is, so the locked screen names it correctly. */
  via?: 'plan' | 'programme'
}) {
  const t = await getTranslations('games')
  const format = await getFormatter()

  const games = [
    {
      href: `${hubHref}/mystery-box`,
      key: 'box',
      Icon: Gift,
      from: '#7c3aed',
      to: '#c026d3',
    },
    {
      href: `${hubHref}/wheel`,
      key: 'wheel',
      Icon: Ticket,
      from: '#0ea5e9',
      to: '#22c55e',
    },
  ] as const

  /*
    ── NOBODY IS PROMISED PLAYS THEY WILL NEVER GET ──────────────────────────

    ⚠️ THE FREE PLAN GRANTS ZERO GAME PLAYS. `tiers.weekly_game_plays` is 0 on
    the default tier, so a free account read "No plays left this week" over
    "New plays on Monday 11 Aug" — a renewal that has never once arrived and
    never will. The strip was written for somebody who SPENT their plays, and
    it cannot tell that apart from somebody who was never given any.

    `allowance` is the number to branch on, not `remaining`: spent-out is
    allowance 4 / remaining 0, and having none at all is allowance 0. It
    already includes plays won as prizes, so an account that somehow holds an
    extra play still gets the real hub — which is right, because that play is
    real.

    Operator, 2026-08-08: greet them with the upgrade instead.
  */
  if (status.allowance === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-1 pb-10 pt-2">
        <header className="animate-rise text-center">
          <h1 className="text-[1.5rem] font-bold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
          <p className="mt-1 text-[0.875rem] text-ink-500">{t(`locked.${via}.subtitle`)}</p>
        </header>

        <section
          style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
          className="animate-rise mt-5 overflow-hidden rounded-(--radius-panel) border border-brand-600/25 bg-surface"
        >
          {/* The number is the message. Somebody who reads nothing else on this
              screen should still leave knowing their allowance is zero. */}
          <div className="flex items-center gap-4 border-b border-ink-200 bg-brand-50 px-4 py-4">
            <span
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-600/15 text-brand-700"
            >
              <Lock className="size-5" />
            </span>
            <p className="min-w-0 text-[0.9375rem] font-semibold leading-snug text-ink-900">
              {t(`locked.${via}.title`)}
            </p>
          </div>

          <div className="px-4 py-4">
            <p className="text-[0.8125rem] leading-relaxed text-ink-600">
              {t(`locked.${via}.body`)}
            </p>
            <Link
              href={upgradeHref}
              className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-control) bg-brand-600 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              {t(`locked.${via}.cta`)}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </section>

        {/* The two games, shown but not openable. What is behind the upgrade is
            the reason to take it, so hiding them would be selling blind. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {games.map((game, index) => (
            <div
              key={game.key}
              style={{ '--rise-delay': `${0.1 + index * 0.05}s` } as React.CSSProperties}
              className="animate-rise relative overflow-hidden rounded-(--radius-panel) p-5 text-white"
            >
              <span
                aria-hidden
                className="absolute inset-0 opacity-45 saturate-50"
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
              <span
                className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-black/30"
                title={t(`locked.${via}.title`)}
              >
                <Lock aria-hidden className="size-3.5" />
              </span>
            </div>
          ))}
        </div>

        {/* No fairness note here. It ends "unused plays do not carry over to
            next week", which is about managing an allowance somebody does not
            have — and the sentence they need to read on this screen is the one
            about the upgrade. */}
      </div>
    )
  }

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
