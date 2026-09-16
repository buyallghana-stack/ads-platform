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
  /*
    `@/` means `src/` here exactly as it does in the app, so a test that
    exercises a pure module imports it by the same path the component does.
    Vitest does not read tsconfig `paths` on its own, and the alternative is a
    `../../src/...` climb that goes stale the moment a test file moves.
  */
  resolve: {
    alias: { '@': resolve(process.cwd(), 'src') },
  },

  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',

    /*
      Every test runs inside one transaction, and two transactions writing the
      same config rows block on each other rather than failing cleanly. Serial
      is not a performance compromise here; it is what makes the results mean
      anything.

      ⚠️ MEASURED, 16 September 2026, so nobody spends another afternoon on it.
      Moving the suite off the shared production database to `sideperks-test`
      removed the contention with live traffic, and the obvious next thought is
      that files can now run alongside each other. They cannot, and the reason
      is not the database they are on.

      `pinLadder` and `setConfig` exist because a money test must not assert
      against whatever was last typed into the admin. They pin by WRITING the
      same `tiers` and `app_config` rows every file needs. Run two files at
      once and their transactions queue on those row locks, so the work
      serialises anyway and the extra workers are pure overhead.

      The numbers, same 8 files, same database: 540s serial, still unfinished
      at 560s parallel.

      Making this work is not a config change. It needs the fixtures to stop
      sharing rows, which means either a database per worker or config read
      through something transaction-local rather than a table.
    */
    fileParallelism: false,
    sequence: { concurrent: false },

    /*
      The suite talks to a database in Paris over the network. The default 5s
      is enough for a fast test and not for a slow one on a bad line.

      HISTORY, because the number looks arbitrary otherwise. This was 30s,
      chosen when a round trip was ~130ms and the suite was ~200 tests. On
      2026-08-06 two consecutive runs failed with a different random pair of
      tests timing out at exactly the limit, every one of them passing in
      isolation — the signature of an environment problem, not a logic one.

      The cause was measured rather than guessed: `withRollback` opened a FRESH
      CONNECTION per test, and a connect-plus-TLS to Supabase costs ~1.7
      SECONDS. Across 430 tests that was ~14 minutes of every run, and its
      variance was what pushed a random test over. The harness now reuses one
      connection (see tests/support/db.ts) and the run went 1850s → 1030s.

      60s is kept rather than restored to 30s: the churn is gone, but the link
      to Paris measurably varies on this project — it was ~130ms this morning
      and ~200ms this evening — and this value only ever bounds a HANG. It is
      not a performance budget, and nothing is hidden behind it now that the
      per-test overhead has been removed at the source.
    */
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
