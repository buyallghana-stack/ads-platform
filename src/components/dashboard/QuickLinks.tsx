import { Gamepad2, Gift, ListChecks, Trophy } from 'lucide-react'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * The four shortcuts under the balance card: Games, Leaderboard, Gift code,
 * Tasks.
 *
 * Operator brief, 2026-07-30. Design references were waived for this one
 * ("explore freely") — a one-off, like the Ads tab, not a new default.
 *
 * THREE OF THE FOUR ARE DISABLED, at the operator's choice, because only gift
 * codes are built. They render greyed and are not tappable, so the row shows
 * what is coming without a tap that goes nowhere. `aria-disabled` plus a
 * `<span>` rather than a link means a screen reader and a keyboard both agree
 * with what the styling says — a disabled-looking anchor that still navigates
 * is the version of this that fails an audit.
 *
 * WHY A ROW OF FOUR AND NOT A GRID. At 390px four items at 25% each leave
 * ~97px per tile, which fits a 44px touch target and a one-word label without
 * truncating. A 2x2 grid would push the stat cards below the fold on a phone,
 * and this row's whole job is to be reachable with a thumb straight after the
 * balance.
 */

type Tone = 'violet' | 'orange' | 'brand' | 'success'

type Item = {
  key: 'games' | 'leaderboard' | 'gift' | 'tasks'
  href: string
  icon: React.ReactNode
  ready: boolean
  tone: Tone
}

/*
  WHY THESE FOUR COLOURS AND NOT FOUR OF THE SAME.

  The row used to be four orange chips. Orange appears nowhere else on the
  dashboard — the stat cards above it are brand blue, violet and success green
  — so the band read as a strip lifted from another product and dropped in.

  Four identical chips also do no work. Colour on a row of shortcuts is the
  cheapest way to make a destination findable by memory rather than by reading,
  which is the whole point of a shortcut; when every tile is the same hue the
  eye has to read all four labels every time.

  So each tile takes a tone that is (a) already on this screen and (b) means
  something: violet for Games matches the tier card it sits under, orange stays
  on the Leaderboard trophy where a gold-ish tone is the obvious one, brand blue
  marks Gift code as the one that puts money in, and success green marks Tasks
  as the things-to-complete tile. The tokens are the same accent set StatCard
  uses, so nothing new enters the palette.
*/
const TONE_ON: Record<Tone, string> = {
  violet: 'border-violet-600/20 bg-violet-50 text-violet-600',
  orange: 'border-orange-500/25 bg-orange-50 text-orange-600',
  brand: 'border-brand-600/20 bg-brand-50 text-brand-600',
  success: 'border-success-500/25 bg-success-50 text-success-600',
}

/* Games are built but gated: `games_enabled` is off until the licensing
   question around paying for chances at a random prize is settled, so the
   tile follows the switch rather than being hard-coded live.

   Leaderboard follows the same shape as of `leaderboard_enabled`: the
   operator can take it down temporarily (abuse, a recount, whatever) without
   a deploy. `ready: true` here is just the tile's starting point — it is
   overridden below exactly like `games` is. */
const ITEMS: Item[] = [
  { key: 'games', href: '/games', icon: <Gamepad2 />, ready: false, tone: 'violet' },
  { key: 'leaderboard', href: '/leaderboard', icon: <Trophy />, ready: true, tone: 'orange' },
  { key: 'gift', href: '/gift-code', icon: <Gift />, ready: true, tone: 'brand' },
  { key: 'tasks', href: '/tasks', icon: <ListChecks />, ready: true, tone: 'success' },
]

/* The tile, shared so an enabled and a disabled one cannot drift apart in
   anything except the states that are supposed to differ. */
function Tile({
  icon,
  label,
  ready,
  tone,
  hasDot = false,
}: {
  icon: React.ReactNode
  label: string
  ready: boolean
  tone: Tone
  hasDot?: boolean
}) {
  return (
    <span
      className={cn(
        'flex flex-col items-center gap-2 rounded-(--radius-card) px-1 py-3 transition-colors',
        ready
          ? 'text-ink-700 hover:bg-ink-50 active:bg-ink-100'
          : 'cursor-not-allowed text-ink-300',
      )}
    >
      <span className="relative">
        <span
          aria-hidden
          className={cn(
            'grid size-11 place-items-center rounded-full border transition-colors',
            ready ? TONE_ON[tone] : 'border-ink-200 bg-ink-50 text-ink-300',
          )}
        >
          {/* Sized here rather than on each icon so the four are identical. */}
          <span className="[&>svg]:size-[1.15rem]">{icon}</span>
        </span>
        {ready && hasDot && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-rose-500 shadow-xs"
          />
        )}
      </span>
      <span className="text-center text-[0.6875rem] font-medium leading-tight">{label}</span>
    </span>
  )
}

export function QuickLinks({
  anchor,
  labels,
  soonLabel,
  navLabel,
  gamesEnabled = false,
  leaderboardEnabled = true,
  hasUnplayedGames = false,
  hasUnclaimedTasks = false,
}: {
  /** `data-tour` value, so the first-run walkthrough can point at this row. */
  anchor?: string
  labels: Record<Item['key'], string>
  /** Drives the Games tile. See the note on ITEMS. */
  gamesEnabled?: boolean
  /** Drives the Leaderboard tile. Defaults on, unlike Games, because the
   *  leaderboard is a shipped feature the operator can pause — not one
   *  waiting on a launch decision. */
  leaderboardEnabled?: boolean
  /** Whether user has unplayed free spins/games remaining. */
  hasUnplayedGames?: boolean
  /** Whether user has completed tasks ready to claim. */
  hasUnclaimedTasks?: boolean
  /** Read by assistive tech on the ones that are not built yet. */
  soonLabel: string
  /** Names the landmark. It was wrongly reading the Gift code label, which
   *  announced the whole row as "Gift code navigation". */
  navLabel: string
}) {
  return (
    <nav
      aria-label={navLabel}
      data-tour={anchor}
      style={{ '--rise-delay': '0.08s' } as React.CSSProperties}
      className="animate-rise grid grid-cols-4 gap-1 rounded-(--radius-panel) border border-ink-200 bg-surface p-1.5 sm:gap-2 sm:p-2"
    >
      {ITEMS.map((raw) => {
        const item =
          raw.key === 'games'
            ? { ...raw, ready: gamesEnabled }
            : raw.key === 'leaderboard'
              ? { ...raw, ready: leaderboardEnabled }
              : raw
        const hasDot =
          (item.key === 'games' && hasUnplayedGames) ||
          (item.key === 'tasks' && hasUnclaimedTasks)

        return item.ready ? (
          <Link key={item.key} href={item.href} className="rounded-(--radius-card)">
            <Tile icon={item.icon} label={labels[item.key]} ready tone={item.tone} hasDot={hasDot} />
          </Link>
        ) : (
          <span
            key={item.key}
            aria-disabled="true"
            /* Not a link and not focusable: the styling says unavailable, and
               the markup has to say the same thing. */
            title={`${labels[item.key]} — ${soonLabel}`}
          >
            <Tile icon={item.icon} label={labels[item.key]} ready={false} tone={item.tone} hasDot={false} />
            <span className="sr-only">{soonLabel}</span>
          </span>
        )
      })}
    </nav>
  )
}
