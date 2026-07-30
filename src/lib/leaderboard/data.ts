import 'server-only'

import { avatarPublicUrl } from '@/lib/profile/avatar'
import { createClient } from '@/lib/supabase/server'
import {
  LEADERBOARD_PERIODS,
  type LeaderboardData,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type PeriodBoard,
  type Standing,
  asMovement,
} from '@/lib/leaderboard/types'

/**
 * Data assembly for the leaderboard.
 *
 * Read through the USER's client, not the service client. `get_leaderboard`
 * and `get_leaderboard_standing` are SECURITY DEFINER and granted to
 * `authenticated` precisely because they decide for themselves what a caller
 * may see — the board returns abbreviated names and nothing else, and the
 * standing takes no user id at all, reading `auth.uid()` instead. A service
 * key on a screen loaded this often would be handing out a master key to save
 * nothing.
 *
 * ALL FOUR PERIODS ARE FETCHED IN ONE PAGE LOAD, in parallel, and the tabs
 * switch with no round trip. Same reasoning as the Ads feed: on a cheap phone
 * on a Ghanaian mobile connection, a spinner between Day and Week is worse
 * than a slightly larger first payload. If the aggregate ever gets expensive
 * — it reads the ledger once per call, so eight calls per view — the escape
 * hatch is to fetch the visible tab here and the rest through a server action
 * on demand, not to cache, because a stale rank is a rank somebody will argue
 * about.
 *
 * The shapes live in `./types`, which has no server imports, because this
 * file is `server-only` and the view that renders it is a client component.
 */

type RawRow = {
  rank: number | string
  user_id: string
  display_name: string | null
  avatar_path: string | null
  points: number | string
  previous_rank: number | string | null
  movement: string | null
}

type RawStanding = {
  rank: number | string
  points: number | string
  previous_rank: number | string | null
  movement: string | null
  total_ranked: number | string
}

/* bigint comes back from PostgREST as a number inside the safe range, but the
   cast is cheap and a rank rendered as "1,234" instead of 1234 because it was
   a string would be a silly way to break a scoreboard. */
const num = (value: number | string | null | undefined): number => Number(value ?? 0)

export async function getLeaderboardData(userId: string): Promise<LeaderboardData> {
  const supabase = await createClient()

  const results = await Promise.all(
    LEADERBOARD_PERIODS.flatMap((period) => [
      supabase.rpc('get_leaderboard', { p_period: period }),
      supabase.rpc('get_leaderboard_standing', { p_period: period }),
    ]),
  )

  const boards = {} as Record<LeaderboardPeriod, PeriodBoard>

  LEADERBOARD_PERIODS.forEach((period, index) => {
    const boardRes = results[index * 2]
    const standingRes = results[index * 2 + 1]

    const rawRows = (boardRes?.data ?? []) as RawRow[]
    const rows: LeaderboardRow[] = rawRows.map((row) => ({
      rank: num(row.rank),
      userId: row.user_id,
      name: row.display_name ?? 'Someone',
      avatarUrl: avatarPublicUrl(row.avatar_path),
      points: num(row.points),
      previousRank: row.previous_rank === null ? null : num(row.previous_rank),
      movement: asMovement(row.movement),
    }))

    /* The function returns at most one row, and none at all for somebody who
       has earned nothing this period — which is a real state (a new account
       on the Day tab) and renders as "not ranked yet", not as zeroth place. */
    const rawStanding = ((standingRes?.data ?? []) as RawStanding[])[0]
    const standing: Standing = rawStanding
      ? {
          rank: num(rawStanding.rank),
          points: num(rawStanding.points),
          previousRank: rawStanding.previous_rank === null ? null : num(rawStanding.previous_rank),
          movement: asMovement(rawStanding.movement),
          totalRanked: num(rawStanding.total_ranked),
        }
      : null

    boards[period] = { rows, standing }
  })

  return { meId: userId, boards }
}
