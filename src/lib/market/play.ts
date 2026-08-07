import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The affiliate side's games, board and tasks.
 *
 * Separate module from `data.ts` for the same reason the tables are separate:
 * these three read from `affiliate_*` and pay in cedis, and nothing here
 * should ever be one import away from a points balance.
 *
 * Service client throughout, like every Phase 2 read: the functions are
 * granted to `service_role` alone and do not re-check the caller, so the
 * screens that call them must stay inside the affiliate route group, which is
 * already behind a session check.
 */

const n = (v: unknown) => Number(v ?? 0)

/* ------------------------------------------------------------------ */
/* Games                                                               */
/* ------------------------------------------------------------------ */

export type AffiliateGameStatus = {
  /** `affiliate_games_enabled`. Off means the screen explains itself. */
  enabled: boolean
  /** From the training programme: Professional 3 a week, Beginner 1. */
  allowance: number
  /** Won back by landing on "one more go". */
  extra: number
  used: number
  left: number
  weekStart: string
}

export async function getAffiliateGameStatus(userId: string): Promise<AffiliateGameStatus> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('affiliate_game_status', { p_user_id: userId })

  if (error || !data) {
    /* A games screen that cannot read its own allowance shows zero plays, not
       an error page: the worst case is somebody told to come back later. */
    return { enabled: false, allowance: 0, extra: 0, used: 0, left: 0, weekStart: '' }
  }

  const raw = data as Record<string, unknown>
  return {
    enabled: raw.enabled === true,
    allowance: n(raw.allowance),
    extra: n(raw.extra),
    used: n(raw.used),
    left: n(raw.left),
    weekStart: String(raw.week_start ?? ''),
  }
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

export type LeaderboardPeriod = 'week' | 'month' | 'all'

export type AffiliateBoardRow = {
  rank: number
  userId: string
  name: string
  avatarPath: string | null
  amountMinor: number
  movement: 'up' | 'down' | 'same' | 'new'
}

export type AffiliateStanding =
  | { ranked: false }
  | { ranked: true; rank: number; amountMinor: number; movement: AffiliateBoardRow['movement'] }

export async function getAffiliateLeaderboard(
  period: LeaderboardPeriod,
): Promise<AffiliateBoardRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('affiliate_leaderboard', { p_period: period })
  if (error || !data) return []

  return (data as unknown as Record<string, unknown>[]).map((r) => ({
    rank: n(r.rank),
    userId: String(r.user_id),
    name: String(r.display_name ?? ''),
    avatarPath: (r.avatar_path as string | null) ?? null,
    amountMinor: n(r.amount_minor),
    movement: (r.movement as AffiliateBoardRow['movement']) ?? 'same',
  }))
}

/**
 * Where the person looking at it stands.
 *
 * Read separately from the board because the board is capped: somebody in
 * 140th place is not in the top 100, and a leaderboard that cannot tell them
 * their own position is missing the only line they came for.
 */
export async function getAffiliateStanding(
  userId: string,
  period: LeaderboardPeriod,
): Promise<AffiliateStanding> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('affiliate_leaderboard_standing', {
    p_user_id: userId,
    p_period: period,
  })
  if (error || !data) return { ranked: false }

  const raw = data as Record<string, unknown>
  if (raw.ranked !== true) return { ranked: false }
  return {
    ranked: true,
    rank: n(raw.rank),
    amountMinor: n(raw.amount_minor),
    movement: (raw.movement as AffiliateBoardRow['movement']) ?? 'same',
  }
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type AffiliateTask = {
  id: string
  code: string
  name: string
  description: string | null
  metric: 'sales' | 'referrals' | 'games_played' | 'leaderboard_rank'
  target: number
  rewardMinor: number
  icon: string | null
  /** For `leaderboard_rank` this is a PLACE, and 0 means unranked. */
  progress: number
  claimed: boolean
  claimedAt: string | null
  /** The database's own verdict. Never recomputed here: a rank is reached by
   *  going down to the target and everything else by going up to it, and two
   *  places deciding that is one place too many. */
  ready: boolean
}

export async function getAffiliateTasks(userId: string): Promise<AffiliateTask[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_affiliate_tasks', { p_user_id: userId })
  if (error || !data) return []

  return (data as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    metric: r.metric as AffiliateTask['metric'],
    target: n(r.target),
    rewardMinor: n(r.reward_minor),
    icon: (r.icon as string | null) ?? null,
    progress: n(r.progress),
    claimed: r.claimed === true,
    claimedAt: (r.claimed_at as string | null) ?? null,
    ready: r.ready === true,
  }))
}
