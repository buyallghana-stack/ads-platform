/**
 * Applies one migration file to the linked project and records it the way the
 * Supabase tooling would.
 *
 * Exists because the MCP `apply_migration` tool needs the whole file pasted
 * through the model, which is wasteful for anything long and risks a
 * transcription slip in SQL that touches money. This reads the file from disk
 * instead, runs it in ONE transaction (so a mistake half way leaves nothing
 * behind), and writes the `supabase_migrations.schema_migrations` row so a
 * later session can still tell what has been applied.
 *
 *   node --env-file=.env.local scripts/apply-migration.mjs supabase/migrations/<file>.sql
 *
 * That targets sideperks-TEST. Production has to be asked for by name:
 *
 *   node --env-file=.env.local scripts/apply-migration.mjs <file>.sql --production
 *
 * Either way it prints the project ref it is about to write to.
 *
 * `--env-file` rather than dotenv, which this project does not depend on and
 * does not need to for one script.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

import pg from 'pg'

const file = process.argv[2]
if (!file) throw new Error('Pass the migration file path.')

const name = basename(file, '.sql')
const version = name.slice(0, 14)
const label = name.slice(15)
if (!/^\d{14}$/.test(version)) throw new Error(`Cannot read a version from ${name}`)

const sql = readFileSync(file, 'utf8')

/*
 * ⚠️ WHICH DATABASE, SAID OUT LOUD.
 *
 * This script used to read `SUPABASE_DB_URL` and nothing else, and print
 * "applied <name>" whichever database that happened to be. `SUPABASE_DB_URL`
 * is sideperks-TEST. A migration has already been reported as live on
 * production in this project when it had only ever reached the test project,
 * and the output gave no way to tell.
 *
 * So production now needs asking for by name, and every run prints the project
 * ref it is about to touch before it touches it.
 */
const production = process.argv.includes('--production')
const connectionString = production ? process.env.PRODUCTION_DB_URL : process.env.SUPABASE_DB_URL

if (!connectionString) {
  throw new Error(
    production
      ? 'PRODUCTION_DB_URL is not set. Pass the production connection string in .env.local.'
      : 'SUPABASE_DB_URL is not set. See tests/README.md for where to get it.',
  )
}

/** The project ref out of the connection string, never the credentials. */
const ref = /postgres\.([a-z0-9]+)/.exec(connectionString)?.[1] ?? 'unknown'
console.log(`target: ${production ? 'PRODUCTION' : 'test'}  project ${ref}`)

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
})

await client.connect()
try {
  await client.query('begin')
  await client.query(sql)
  await client.query(
    `insert into supabase_migrations.schema_migrations (version, name, statements)
     values ($1, $2, array[$3::text])
     on conflict (version) do nothing`,
    [version, label, sql],
  )
  await client.query('commit')
  console.log(`applied ${name}`)
} catch (error) {
  await client.query('rollback')
  console.error('FAILED, nothing was applied:', error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
