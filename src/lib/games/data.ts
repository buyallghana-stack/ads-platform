import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { GameFace, GameKind, GameStatus } from '@/lib/games/types'

/**
 * Data for the game screens.
 *
 * Read through the USER's client. `get_game_status` and `get_game_board` are
 * SECURITY DEFINER and granted to `authenticated` because they answer for the
 * caller themselves — the status takes no user id at all, and the board
 * returns labels, points and colours with the WEIGHTS deliberately left
 * behind. `play_game` is the opposite: revoked from every client role and
 * called through the service client from a server action, because it is the
 * one that mints points.
 */

type RawStatus = {
  enabled: boolean
  allowance: number
  used: number
  remaining: number
  week_ends_at: string
}

type RawFace = {
  slot: number
  label: string
  points: number | string
  extra_plays: number
  colour: string
}

export async function getGameStatus(): Promise<GameStatus> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_game_status')
  const row = ((data ?? []) as RawStatus[])[0]

  /* Defaulting to DISABLED when the read fails is deliberate: the switch is
     off for a legal reason, so the failure mode has to be "no game", never
     "game". */
  if (!row) {
    return { enabled: false, allowance: 0, used: 0, remaining: 0, weekEndsAt: new Date().toISOString() }
  }

  return {
    enabled: Boolean(row.enabled),
    allowance: Number(row.allowance ?? 0),
    used: Number(row.used ?? 0),
    remaining: Number(row.remaining ?? 0),
    weekEndsAt: row.week_ends_at,
  }
}

export async function getGameBoard(game: GameKind): Promise<GameFace[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_game_board', { p_game: game })

  return ((data ?? []) as RawFace[]).map((f) => ({
    slot: Number(f.slot),
    label: f.label,
    points: Number(f.points),
    extraPlays: Number(f.extra_plays ?? 0),
    colour: f.colour,
  }))
}

/**
 * Whether the games are on, for the shortcut tile on Home.
 *
 * `games_enabled` is `is_public`, so the user client may read it — which is
 * the ONLY reason this is safe. The app_config select policy is
 * `is_public or is_admin()`, so a private key read this way comes back null
 * and LOOKS CORRECT while testing as an admin. Never copy this pattern for a
 * key without checking that flag.
 */
export async function getGamesEnabled(): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'games_enabled')
    .maybeSingle()

  return data?.value === 'true'
}
