/**
 * Game shapes with no server imports, for the same reason the leaderboard has
 * a types module: `data.ts` is `server-only` and the game screens are client
 * components, so importing across that line fails the Turbopack build.
 */

export const GAME_KINDS = ['mystery_box', 'spin_wheel'] as const
export type GameKind = (typeof GAME_KINDS)[number]

/** URL segment <-> database enum. The enum is snake_case; a URL should not be. */
export const GAME_SLUGS: Record<string, GameKind> = {
  'mystery-box': 'mystery_box',
  wheel: 'spin_wheel',
}

export const SLUG_FOR: Record<GameKind, string> = {
  mystery_box: 'mystery-box',
  spin_wheel: 'wheel',
}

/**
 * One face of a game — a box or a wedge.
 *
 * Note what is NOT here: the weight. The odds never leave the database. A
 * player who can read them knows which box is worth picking, which turns the
 * mystery box into a lookup table.
 */
export type GameFace = {
  slot: number
  label: string
  points: number
  extraPlays: number
  colour: string
}

export type GameStatus = {
  enabled: boolean
  allowance: number
  used: number
  remaining: number
  /** ISO. When unused plays are forfeited — next Monday, 00:00 UTC. */
  weekEndsAt: string
}

export type PlayResult =
  | {
      ok: true
      /** Which face the draw landed on. The wheel must stop here; the box
       *  reveals this prize inside whichever box the player tapped. */
      slot: number
      label: string
      points: number
      extraPlays: number
      remaining: number
    }
  | {
      ok: false
      reason:
        | 'games_disabled'
        | 'no_plays_left'
        | 'too_soon'
        | 'account_disabled'
        | 'no_prizes_configured'
        | 'not_signed_in'
        | 'error'
    }
