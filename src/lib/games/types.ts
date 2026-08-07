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
  /**
   * What the face is worth, in whatever unit the SKIN is denominated in:
   * points on the ads side, pesewas on the affiliate side. The components
   * never format it themselves, so neither of them has to know.
   */
  value: number
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
      /** Same unit as `GameFace.value`. See the skin. */
      value: number
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

/**
 * What makes the same three components serve two businesses.
 *
 * The ads games pay POINTS and the affiliate games pay CEDIS. Everything else
 * about them is identical, and the operator's requirement is that they stay
 * identical: "perfectly copy the ads games and leaderboard mechanism and
 * display" (2026-08-07). Two copies of a spinning wheel would have drifted
 * inside a week.
 *
 * So there is one wheel and one box, and the parts that genuinely differ are
 * injected: where a play is recorded, how a figure is written, and where the
 * screen's own links go. Nothing about the LAYOUT is skinnable, which is the
 * point.
 */
export type GameSkin = {
  /** Records the play. The only place a business's own engine is named. */
  play: (game: GameKind) => Promise<PlayResult>
  /**
   * Which of the two the numbers are. `points` keeps the ads reveal reading
   * exactly as it did, "+300 points", with the word coming from the message
   * files; `money` prints what `formatValue` returns and nothing else, because
   * "GHS 12.50 points" would be nonsense.
   */
  unit: 'points' | 'money'
  /** "1,250" on the ads side, "GHS 12.50" on the affiliate side. */
  formatValue: (value: number) => string
  /** Short form for a wheel wedge, where there is room for about five glyphs. */
  formatWedge: (value: number) => string
  /** The games hub this game belongs to. */
  hubHref: string
  /** Where more plays come from when the week's allowance is spent. */
  moreHref: string
}
