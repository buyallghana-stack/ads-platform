/**
 * Leaderboard shapes and constants, with no server imports.
 *
 * This file exists because `data.ts` is `server-only`, and importing it from a
 * client component fails the Turbopack build outright — the same split as
 * `admin/types.ts` versus `admin/preview.ts`. Anything a client component
 * needs to know about the leaderboard lives here; anything that talks to the
 * database lives there.
 */

export const LEADERBOARD_PERIODS = ['day', 'week', 'month', 'all'] as const
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number]

export type Movement = 'up' | 'down' | 'same' | 'new'

export type LeaderboardRow = {
  rank: number
  userId: string
  /** First name + last initial. The full name is not fetched at all. */
  name: string
  points: number
  previousRank: number | null
  movement: Movement
}

export type Standing = {
  rank: number
  points: number
  previousRank: number | null
  movement: Movement
  totalRanked: number
} | null

export type PeriodBoard = {
  rows: LeaderboardRow[]
  standing: Standing
}

export type LeaderboardData = {
  /** The signed-in user, so their own row can be marked and scrolled to. */
  meId: string
  boards: Record<LeaderboardPeriod, PeriodBoard>
}

export const asMovement = (value: unknown): Movement =>
  value === 'up' || value === 'down' || value === 'new' ? value : 'same'

export function isLeaderboardPeriod(value: unknown): value is LeaderboardPeriod {
  return LEADERBOARD_PERIODS.includes(value as LeaderboardPeriod)
}
