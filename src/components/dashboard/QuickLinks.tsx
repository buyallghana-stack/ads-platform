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

type Item = {
  key: 'games' | 'leaderboard' | 'gift' | 'tasks'
  href: string
  icon: React.ReactNode
  ready: boolean
}

const ITEMS: Item[] = [
  { key: 'games', href: '/games', icon: <Gamepad2 />, ready: false },
  { key: 'leaderboard', href: '/leaderboard', icon: <Trophy />, ready: false },
  { key: 'gift', href: '/gift-code', icon: <Gift />, ready: true },
  { key: 'tasks', href: '/tasks', icon: <ListChecks />, ready: false },
]

/* The tile, shared so an enabled and a disabled one cannot drift apart in
   anything except the states that are supposed to differ. */
function Tile({
  icon,
  label,
  ready,
}: {
  icon: React.ReactNode
  label: string
  ready: boolean
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
      <span
        aria-hidden
        className={cn(
          'grid size-11 place-items-center rounded-full border transition-colors',
          ready
            ? 'border-orange-500/25 bg-orange-50 text-orange-600'
            : 'border-ink-200 bg-ink-50 text-ink-300',
        )}
      >
        {/* Sized here rather than on each icon so the four are identical. */}
        <span className="[&>svg]:size-[1.15rem]">{icon}</span>
      </span>
      <span className="text-center text-[0.6875rem] font-medium leading-tight">{label}</span>
    </span>
  )
}

export function QuickLinks({
  labels,
  soonLabel,
}: {
  labels: Record<Item['key'], string>
  /** Read by assistive tech on the three that are not built yet. */
  soonLabel: string
}) {
  return (
    <nav
      aria-label={labels.gift}
      style={{ '--rise-delay': '0.08s' } as React.CSSProperties}
      className="animate-rise grid grid-cols-4 gap-1 rounded-(--radius-panel) border border-ink-200 bg-surface p-1.5 sm:gap-2 sm:p-2"
    >
      {ITEMS.map((item) =>
        item.ready ? (
          <Link key={item.key} href={item.href} className="rounded-(--radius-card)">
            <Tile icon={item.icon} label={labels[item.key]} ready />
          </Link>
        ) : (
          <span
            key={item.key}
            aria-disabled="true"
            /* Not a link and not focusable: the styling says unavailable, and
               the markup has to say the same thing. */
            title={`${labels[item.key]} — ${soonLabel}`}
          >
            <Tile icon={item.icon} label={labels[item.key]} ready={false} />
            <span className="sr-only">{soonLabel}</span>
          </span>
        ),
      )}
    </nav>
  )
}
