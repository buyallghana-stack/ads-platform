import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Test config for the money-critical suite.
 *
 * `.env.local` is read here by hand rather than through Vite's `loadEnv`,
 * which Vitest 4 no longer re-exports. Six lines of parsing is a smaller
 * commitment than a dotenv dependency that exists to serve one variable.
 *
 * That variable is `SUPABASE_DB_URL`, and it deliberately never gets a
 * `VITE_`/`NEXT_PUBLIC_` prefix: those are the prefixes that mean "safe to
 * ship to a browser", and this is a database superuser connection string.
 * These tests run in Node, so `process.env` is all they need.
 */
function loadEnvFile(): void {
  let contents: string
  try {
    contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  } catch {
    return // Nothing to load. The suite's guard test says so out loud.
  }

  for (const line of contents.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    // Anything already in the real environment wins, so CI can override.
    if (process.env[key!] !== undefined) continue
    process.env[key!] = rawValue!.trim().replace(/^["']|["']$/g, '')
  }
}

loadEnvFile()

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',

    // Every test runs inside one transaction on a SHARED dev database, and
    // two transactions writing the same config rows deadlock rather than fail
    // cleanly. Serial is not a performance compromise here; it is what makes
    // the results mean anything.
    fileParallelism: false,
    sequence: { concurrent: false },

    /*
      The suite talks to a database in Paris over the network. The default 5s
      is enough for a fast test and not for a slow one on a bad line.

      RAISED FROM 30s TO 60s ON 2026-08-06, and the reason is worth writing
      down because "just raise the timeout" is usually the wrong answer.

      This value was chosen when a round trip was ~130ms and the suite was
      ~200 tests. It is now 430 tests and a round trip measures ~200ms, but the
      dominant cost is not the queries: `withRollback` opens a FRESH
      CONNECTION per test, and a connect-plus-TLS-handshake to Supabase
      measures ~1.7 SECONDS. That is roughly twelve minutes of every run spent
      connecting, and its variance is what pushes a random test past the limit
      — a different two each run, all of them passing in isolation.

      So the timeout is not masking slow tests; it is a hang detector that was
      calibrated against different conditions. The real fix is to reuse one
      connection across the serial suite, which would remove those twelve
      minutes outright. That is a change to the harness every test depends on
      and belongs in its own commit, not tacked onto a pricing change.
    */
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
