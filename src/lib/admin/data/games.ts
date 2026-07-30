import 'server-only'

import { getSessionUser } from '@/lib/auth/session'
import type { GameKind } from '@/lib/games/types'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The admin's view of a game.
 *
 * SERVICE client throughout: every one of these functions is revoked from
 * client roles because they carry the WEIGHTS, and the weights are the odds.
 * A player who can read them knows which box to pick. The acting admin's id
 * comes from the verified session and `assert_admin` re-checks it inside each
 * function.
 */

export type AdminPrize = {
  id: string
  slot: number
  label: string
  points: number
  extraPlays: number
  weight: number
  colour: string
  dailyCap: number
  weeklyCap: number
  isActive: boolean
  /** Derived in SQL from the sibling weights. Never stored. */
  chancePercent: number
  wonToday: number
  wonThisWeek: number
}

export type GameStats = {
  playsTotal: number
  playsPeriod: number
  pointsPeriod: number
  /** What the weights promise per play. */
  expectedRtp: number
  /** What the draws actually paid per play. */
  actualRtp: number
  playersPeriod: number
  extraPlaysWon: number
}

export type TierPlays = {
  id: string
  slug: string
  name: string
  priceMinor: number
  weeklyGamePlays: number
  isDefault: boolean
  isActive: boolean
}

async function actingAdmin(): Promise<string | null> {
  const user = await getSessionUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .maybeSingle()
  return data ? user.id : null
}

export async function getGamePrizes(game: GameKind): Promise<AdminPrize[]> {
  const adminId = await actingAdmin()
  if (!adminId) return []

  const admin = createAdminClient()
  const { data } = await admin.rpc('admin_list_game_prizes', {
    p_admin_id: adminId,
    p_game: game,
  })

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    slot: Number(r.slot),
    label: String(r.label ?? ''),
    points: Number(r.points ?? 0),
    extraPlays: Number(r.extra_plays ?? 0),
    weight: Number(r.weight ?? 0),
    colour: String(r.colour ?? '#2563eb'),
    dailyCap: Number(r.daily_cap ?? 0),
    weeklyCap: Number(r.weekly_cap ?? 0),
    isActive: Boolean(r.is_active),
    chancePercent: Number(r.chance_percent ?? 0),
    wonToday: Number(r.won_today ?? 0),
    wonThisWeek: Number(r.won_this_week ?? 0),
  }))
}

export async function getGameStats(game: GameKind, days = 30): Promise<GameStats | null> {
  const adminId = await actingAdmin()
  if (!adminId) return null

  const admin = createAdminClient()
  const { data } = await admin.rpc('admin_game_stats', {
    p_admin_id: adminId,
    p_game: game,
    p_days: days,
  })
  const row = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!row) return null

  return {
    playsTotal: Number(row.plays_total ?? 0),
    playsPeriod: Number(row.plays_period ?? 0),
    pointsPeriod: Number(row.points_period ?? 0),
    expectedRtp: Number(row.expected_rtp ?? 0),
    actualRtp: Number(row.actual_rtp ?? 0),
    playersPeriod: Number(row.players_period ?? 0),
    extraPlaysWon: Number(row.extra_plays_won ?? 0),
  }
}

export async function getTierPlays(): Promise<TierPlays[]> {
  const adminId = await actingAdmin()
  if (!adminId) return []

  const admin = createAdminClient()
  const { data } = await admin.rpc('admin_list_tier_game_plays', { p_admin_id: adminId })

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    priceMinor: Number(r.price_minor ?? 0),
    weeklyGamePlays: Number(r.weekly_game_plays ?? 0),
    isDefault: Boolean(r.is_default),
    isActive: Boolean(r.is_active),
  }))
}
