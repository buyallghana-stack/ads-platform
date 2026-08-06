import 'server-only'

/**
 * The current instant, for a server render.
 *
 * ── WHY THIS EXISTS RATHER THAN A BARE `Date.now()` ──
 *
 * `react-hooks/purity` rejects `Date.now()` in a component body, and it is
 * right to in the general case: a client component re-renders whenever React
 * decides to, so an impure call there produces a value that changes for
 * reasons the code does not express.
 *
 * A SERVER component does not re-render. It runs once, on one request, and its
 * output is serialised and sent. "Now" at that moment is a fact about the
 * request, not unstable state — and several screens genuinely need it, because
 * relative timestamps ("2 hours ago") are computed in the client from a base
 * the server supplies, so that the server's clock and the browser's clock do
 * not disagree about what "today" means.
 *
 * So the call is legitimate and the lint rule cannot know that. Isolating it in
 * one named, documented, server-only function is better than repeating a
 * suppression comment on every page that needs the time — the reasoning lives
 * in one place, and a future client component that imports this gets a build
 * error from `server-only` rather than a subtle bug.
 *
 * ⚠️ Do NOT use this to decide anything. It is a display base. Every rule that
 * turns on time — whether an entitlement has lapsed, whether a hold has
 * cleared, whether a daily cap has reset — is decided in Postgres against
 * `now()` or `clock_timestamp()`, because a browser's clock is attacker-set and
 * a server's is merely approximate.
 */
export function serverNow(): number {
  return Date.now()
}
