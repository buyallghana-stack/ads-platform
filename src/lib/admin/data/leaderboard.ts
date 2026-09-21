import 'server-only'

import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { type LeaderboardPeriod, type Movement, asMovement } from '@/lib/leaderboard/types'

/**
 * The admin's copy of the leaderboard.
 *
 * SERVICE client, unlike the user-facing board: `admin_get_leaderboard` is
 * revoked from `authenticated` because it carries email and phone, so it
 * cannot be reached with a user's own token by design. The acting admin's id
 * comes from the verified session and `assert_admin` re-checks it inside the
 * function — the same shape as `admin_get_ad`.
 *
 * It is a separate function from `get_leaderboard` rather than a flag on it,
 * so there is no argument anybody could get wrong that would serve personal
 * data to a user. The RANKS are identical: both read the same expression over
 * the same window, so the operator is looking at what the users are looking
 * at, with the person attached.
 */

export type AdminLeaderboardRow = {
  rank: number
  userId: string
  displayName: string
  fullName: string
  email: string
  phone: string | null
  points: number
  previousRank: number | null
  movement: Movement
  flagged: boolean
}

export async function getAdminLeaderboard(
  period: LeaderboardPeriod,
): Promise<AdminLeaderboardRow[]> {
  const user = await getSessionUser()
  if (!user) return []

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_get_leaderboard', {
    p_admin_id: user.id,
    p_period: period,
    p_limit: 200,
  })

  if (error || !data) return []

  return (data as Array<Record<string, unknown>>).map((r) => ({
    rank: Number(r.rank),
    userId: String(r.user_id),
    displayName: String(r.display_name ?? ''),
    fullName: String(r.full_name ?? ''),
    email: String(r.email ?? ''),
    phone: (r.phone as string | null) ?? null,
    points: Number(r.points),
    previousRank: r.previous_rank === null ? null : Number(r.previous_rank),
    movement: asMovement(r.movement),
    flagged: Boolean(r.flagged),
  }))
}
