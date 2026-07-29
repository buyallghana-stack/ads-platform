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
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
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
