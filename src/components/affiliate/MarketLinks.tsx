import { Gamepad2, Gift, ListChecks, Trophy } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * The shortcut row under the dashboard figures.
 *
 * ── IT REPLACED "QUICK TOOLS" (operator, 2026-08-07) ──
 *
 * That row was Browse, Links, Statement, Payouts, and every one of those is
 * already a tab in the bottom bar or one tap inside one. A shortcut strip that
 * duplicates the navigation costs a screenful and teaches nothing. These four
 * are places the bottom bar does NOT go, which is the only thing that earns a
 * tile.
 *
 * ── AND IT MIRRORS THE ADS DASHBOARD ──
 *
 * Same four, same order, same idea: Games, Leaderboard, Gift code, Tasks. A
 * user who holds both businesses learns the row once.
 *
 * ⚠️ GIFT CODE USED TO CROSS, AND THAT WAS WRONG. It pointed at `/gift-code`,
 * the ads screen, on the argument that a gift code credits POINTS and the user
 * simply walks between businesses. The operator's answer (2026-08-07): "the
 * gift code of the affiliate when clicked takes you to the ads ... the gift
 * code that exists is just for the ads." Somebody on the cedis dashboard
 * tapping a tile on the cedis dashboard is asking for cedis. There is now a
 * commission gift code with its own table, its own redeem function and its own
 * admin board, and all four tiles stay in the mode.
 */

const TILES = [
  { key: 'games', href: '/market/games', Icon: Gamepad2, tone: 'text-violet-600 bg-violet-500/12' },
  { key: 'leaderboard', href: '/market/leaderboard', Icon: Trophy, tone: 'text-orange-600 bg-orange-500/12' },
  { key: 'gift', href: '/market/gift-code', Icon: Gift, tone: 'text-brand-700 bg-brand-600/12' },
  { key: 'tasks', href: '/market/tasks', Icon: ListChecks, tone: 'text-success-600 bg-success-500/12' },
] as const

export async function MarketLinks() {
  const t = await getTranslations('affiliate.links')

  return (
    <nav aria-label={t('label')} className="grid grid-cols-4 gap-2">
      {TILES.map(({ key, href, Icon, tone }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-(--radius-card) border border-ink-200 bg-surface px-1 py-3',
            'transition-colors hover:border-ink-300',
          )}
        >
          <span aria-hidden className={cn('grid size-9 place-items-center rounded-full', tone)}>
            <Icon className="size-4.5" />
          </span>
          <span className="text-center text-[0.6875rem] leading-tight font-medium text-ink-700">
            {t(key)}
          </span>
        </Link>
      ))}
    </nav>
  )
}
