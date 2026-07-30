'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

import { Crown, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Avatar } from '@/components/profile/Avatar'
import { cn } from '@/lib/cn'
import type {
  LeaderboardData,
  LeaderboardPeriod,
  LeaderboardRow,
  Movement,
} from '@/lib/leaderboard/types'
import { LEADERBOARD_PERIODS } from '@/lib/leaderboard/types'

/**
 * The leaderboard.
 *
 * Built from the operator's mobile reference (design-references/leaderboard/
 * 01-leaderboard-mobile.jpeg): a podium for the top three with the winner
 * raised and crowned, then a plain ranked list underneath.
 *
 * WHAT CHANGED FROM THE REFERENCE, and why:
 *
 *  - The reference shows an @handle under each name. We have no usernames —
 *    the operator chose first name + last initial — so the second line would
 *    have been empty. The row is single-line instead, and the space goes to
 *    the rank number, which the reference leaves implicit and the operator
 *    explicitly asked for ("ranks like 1st 2nd 3rd").
 *  - Its tabs are All Members / This week / All Friends. Ours are the four
 *    periods. There is no friends graph in this product to build the third on.
 *  - It has a search field. Not asked for, and searching a board of
 *    abbreviated names finds very little; the "My rank" button is the thing
 *    people actually want it for, and that is exact.
 *  - It is dark-only. This renders in both themes like every other screen.
 *
 * ALL FOUR PERIODS ARRIVE WITH THE PAGE, so switching tabs is a state change
 * with no spinner and no request.
 */

const MOVEMENT_ICON: Record<Movement, React.ComponentType<{ className?: string }>> = {
  up: TrendingUp,
  down: TrendingDown,
  same: Minus,
  new: Minus,
}

/* Green up, red down, grey for no change — the one place in this app where
   colour tracks DIRECTION rather than category, because that is what the
   operator asked for and what an arrow means everywhere else. */
const MOVEMENT_TONE: Record<Movement, string> = {
  up: 'text-success-600',
  down: 'text-danger-600',
  same: 'text-ink-300',
  new: 'text-ink-300',
}

/** Podium plates: gold, silver, bronze. Only ever ranks 1-3. */
const MEDAL: Record<number, string> = {
  1: 'from-amber-300 to-amber-500',
  2: 'from-slate-200 to-slate-400',
  3: 'from-orange-300 to-orange-500',
}

function MovementMark({ movement, label }: { movement: Movement; label: string }) {
  const Icon = MOVEMENT_ICON[movement]
  return (
    <span className={cn('inline-flex items-center', MOVEMENT_TONE[movement])} title={label}>
      <Icon aria-hidden className="size-4" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function LeaderboardView({ data }: { data: LeaderboardData }) {
  const t = useTranslations('leaderboard')
  const format = useFormatter()

  const [period, setPeriod] = useState<LeaderboardPeriod>('week')
  const board = data.boards[period]

  /* Scoped to the whole board, podium included — see the data-me note on the
     podium item. A ref rather than a bare document query so two boards on one
     page could never fight over the same target. */
  const boardRef = useRef<HTMLDivElement | null>(null)
  const [flashMe, setFlashMe] = useState(false)

  const podium = useMemo(() => board.rows.filter((r) => r.rank <= 3).slice(0, 3), [board.rows])
  /* Everyone the podium did not take. Sliced by COUNT rather than by rank so
     that a three-way tie for first — all rank 1 — cannot put the same person
     on the podium and in the list underneath. */
  const rest = useMemo(() => board.rows.slice(podium.length), [board.rows, podium.length])

  const meInBoard = board.rows.some((r) => r.userId === data.meId)

  /* The operator's "my rank" button. If the user is on the board we scroll to
     their row and flash it; if they are outside the visible ranks there is
     nothing to scroll to, so the pinned card at the bottom is the answer and
     the button flashes that instead. */
  const jumpToMe = useCallback(() => {
    const target = boardRef.current?.querySelector<HTMLElement>('[data-me="true"]')
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashMe(true)
    window.setTimeout(() => setFlashMe(false), 1600)
  }, [])

  const movementLabel = (movement: Movement, previousRank: number | null, rank: number) => {
    if (movement === 'new') return t('movement.new')
    if (movement === 'same') return t('movement.same')
    const places = previousRank === null ? 0 : Math.abs(previousRank - rank)
    return t(movement === 'up' ? 'movement.up' : 'movement.down', { places })
  }

  return (
    <div ref={boardRef} className="mx-auto w-full max-w-3xl px-1 pb-28 pt-2 md:pb-10">
      <header className="animate-rise text-center">
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
        </h1>
        <p className="mt-1 text-[0.875rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {/* Period tabs — same segmented idiom as Ads and Notifications. */}
      <div
        role="tablist"
        aria-label={t('tabs.label')}
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className="animate-rise mt-4 flex gap-1 rounded-(--radius-input) bg-ink-100 p-1"
      >
        {LEADERBOARD_PERIODS.map((key) => {
          const selected = key === period
          return (
            <button
              key={key}
              role="tab"
              aria-selected={selected}
              onClick={() => setPeriod(key)}
              className={cn(
                'flex-1 rounded-[calc(var(--radius-input)-0.25rem)] px-2 py-2.5',
                'text-[0.8125rem] font-semibold transition-colors sm:text-[0.875rem]',
                selected
                  ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                  : 'text-ink-500 hover:text-ink-700',
              )}
            >
              {t(`tabs.${key}`)}
            </button>
          )
        })}
      </div>

      {board.rows.length === 0 ? (
        <p className="mt-10 rounded-(--radius-panel) border border-dashed border-ink-200 px-6 py-12 text-center text-[0.875rem] text-ink-500">
          {t('empty')}
        </p>
      ) : (
        <>
          {/* ---- Podium ------------------------------------------------- */}
          <ol
            style={{ '--rise-delay': '0.1s' } as React.CSSProperties}
            className="animate-rise mt-6 grid grid-cols-3 items-end gap-2 sm:gap-3"
          >
            {/* Second, first, third — the winner in the middle and raised,
                which is what a podium is. Source order is 1,2,3 so a screen
                reader still hears them in rank order. */}
            {[podium[1], podium[0], podium[2]].map((row, slot) =>
              row ? (
                <li
                  key={row.userId}
                  /* Marked here as well as on a list row: somebody in the top
                     three pressing "My rank" must land somewhere, and without
                     this the button silently did nothing for exactly the
                     people most likely to press it. */
                  data-me={row.userId === data.meId ? 'true' : undefined}
                  className={cn(
                    'relative flex flex-col items-center rounded-(--radius-panel) border px-2 pb-3 text-center',
                    'border-ink-200 bg-surface',
                    slot === 1 ? 'order-2 pt-7' : 'pt-5',
                    slot === 0 && 'order-1',
                    slot === 2 && 'order-3',
                    row.userId === data.meId && 'border-brand-500 ring-1 ring-brand-500/25',
                  )}
                >
                  {row.rank === 1 && (
                    <Crown
                      aria-hidden
                      className="absolute -top-3 size-6 text-amber-400 drop-shadow-sm"
                      strokeWidth={2.25}
                    />
                  )}
                  <Avatar
                    name={row.name}
                    src={row.avatarUrl}
                    className={cn(
                      'text-[0.875rem]',
                      slot === 1 ? 'size-16 sm:size-20' : 'size-12 sm:size-16',
                    )}
                  />
                  <span
                    className={cn(
                      'mt-2 grid size-6 place-items-center rounded-full bg-gradient-to-br',
                      'text-[0.6875rem] font-bold text-white',
                      MEDAL[row.rank] ?? 'from-ink-300 to-ink-400',
                    )}
                  >
                    {row.rank}
                  </span>
                  <span className="mt-1.5 line-clamp-1 w-full text-[0.8125rem] font-semibold text-ink-900">
                    {row.userId === data.meId ? t('you') : row.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[0.75rem] font-medium tabular-nums text-ink-500">
                    {format.number(row.points)}
                    <MovementMark
                      movement={row.movement}
                      label={movementLabel(row.movement, row.previousRank, row.rank)}
                    />
                  </span>
                </li>
              ) : (
                <li key={`empty-${slot}`} aria-hidden className={cn(slot === 1 ? 'order-2' : slot === 0 ? 'order-1' : 'order-3')} />
              ),
            )}
          </ol>

          {/* ---- The rest of the board ---------------------------------- */}
          <div
            style={{ '--rise-delay': '0.15s' } as React.CSSProperties}
            className="animate-rise mt-4 overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface"
          >
            {rest.length === 0 ? (
              <p className="px-4 py-8 text-center text-[0.8125rem] text-ink-500">
                {t('onlyPodium')}
              </p>
            ) : (
              <ol>
                {rest.map((row) => (
                  <Row
                    key={row.userId}
                    row={row}
                    isMe={row.userId === data.meId}
                    flash={flashMe && row.userId === data.meId}
                    youLabel={t('you')}
                    movementLabel={movementLabel(row.movement, row.previousRank, row.rank)}
                    points={format.number(row.points)}
                  />
                ))}
              </ol>
            )}
          </div>
        </>
      )}

      {/* ---- Standing + the jump button -------------------------------- */}
      {board.standing ? (
        <div
          className={cn(
            'fixed inset-x-0 bottom-16 z-30 mx-auto max-w-3xl px-3 md:sticky md:bottom-4 md:px-0',
            'transition-transform',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-3 rounded-(--radius-panel) border px-3.5 py-3 shadow-lg',
              'border-brand-500/30 bg-brand-600 text-white',
              flashMe && !meInBoard && 'ring-2 ring-white/70',
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15 text-[0.8125rem] font-bold tabular-nums">
              {board.standing.rank}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.8125rem] font-semibold">
                {t('yourRank', {
                  rank: board.standing.rank,
                  total: board.standing.totalRanked,
                })}
              </span>
              <span className="block text-[0.75rem] tabular-nums text-white/75">
                {t('yourPoints', { points: format.number(board.standing.points) })}
              </span>
            </span>
            <button
              type="button"
              onClick={jumpToMe}
              className="shrink-0 rounded-(--radius-input) bg-white px-3 py-2 text-[0.8125rem] font-semibold text-brand-700 transition-colors hover:bg-white/90"
            >
              {t('myRank')}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-6 rounded-(--radius-panel) border border-ink-200 bg-surface px-4 py-3 text-center text-[0.8125rem] text-ink-500">
          {t('unranked')}
        </p>
      )}
    </div>
  )
}

function Row({
  row,
  isMe,
  flash,
  youLabel,
  movementLabel,
  points,
}: {
  row: LeaderboardRow
  isMe: boolean
  flash: boolean
  youLabel: string
  movementLabel: string
  points: string
}) {
  return (
    <li
      data-me={isMe ? 'true' : undefined}
      className={cn(
        'flex items-center gap-3 border-b border-ink-100 px-3.5 py-3 last:border-b-0',
        'transition-colors duration-500',
        isMe && 'bg-brand-50',
        flash && 'bg-brand-100',
      )}
    >
      <span className="w-7 shrink-0 text-center text-[0.8125rem] font-bold tabular-nums text-ink-400">
        {row.rank}
      </span>
      <Avatar name={row.name} src={row.avatarUrl} className="size-9 text-[0.6875rem]" />
      <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-ink-900">
        {isMe ? youLabel : row.name}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[0.875rem] font-semibold tabular-nums text-ink-700">
        {points}
        <MovementMark movement={row.movement} label={movementLabel} />
      </span>
    </li>
  )
}
