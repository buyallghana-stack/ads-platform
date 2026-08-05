/**
 * The two modes.
 *
 * Phase 2 is a second BUSINESS sharing this login, not a feature of the first.
 * The obvious implementation — one more item in the nav beside Games and Tasks
 * — was ruled out twice over:
 *
 *   1. It files a whole business under the same heading as a mini-game.
 *   2. `AppNav.tsx` documents five as the ceiling for the bottom tab bar, and
 *      it is already at five. There is no sixth slot to take.
 *   3. It would put BOTH currencies in one navigation. D27 says points and
 *      commission never mix, and the first thing a shared nav invites is a
 *      header reading "your balance".
 *
 * So the app has two modes, each owning its own set of destinations, with one
 * switch between them. The mode boundary is what makes D27 STRUCTURAL rather
 * than a rule somebody has to remember: there is no screen where a points
 * figure and a commission figure are both in scope.
 *
 * Mode is derived from the URL, never stored. A cookie or a piece of client
 * state would eventually disagree with the page being rendered — and the one
 * thing a mode indicator must never do is claim you are somewhere you are not.
 */

export type AppMode = 'earn' | 'market'

/**
 * Market-mode route prefixes.
 *
 * Everything Phase 2 lives under one of these, which is also why they are
 * listed here rather than inferred: adding a Phase 2 screen without adding it
 * to this list would render it with the ads navigation, and the bug would look
 * like a styling mistake rather than a routing one.
 */
const MARKET_PREFIXES = [
  '/market',
  '/shop',
  '/learn',
  '/links',
  '/downline',
  '/commission',
] as const

/** Strips the locale segment so prefixes can be matched against a bare path. */
export function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(en|fr)(?=\/|$)/, '') || '/'
}

/** Which mode a path belongs to. Defaults to `earn` — the ads business is the
 *  one that exists when nothing says otherwise. */
export function modeForPath(pathname: string): AppMode {
  const path = stripLocale(pathname)
  return MARKET_PREFIXES.some((p) => path === p || path.startsWith(p + '/')) ? 'market' : 'earn'
}

/** Where the switch lands. Each mode has one home, and it is always the
 *  dashboard — switching should never drop somebody on a sub-screen of a
 *  business they have just arrived in. */
export const MODE_HOME: Record<AppMode, string> = {
  earn: '/dashboard',
  market: '/market',
}
