/*
  Replays every migration, in order, into the database named by TARGET_DB_URL.

    TARGET_DB_URL=postgres://... node scripts/replay-migrations.cjs [--from <version>]

  Built for standing up a fresh database (a test project, a preview branch)
  from the migration history rather than from a dump.

  Each file runs in its own transaction and is recorded in the ledger, so a
  failure stops at the offending migration with everything before it intact,
  and re-running resumes from there instead of starting over.

  ⚠️ It refuses to touch the production project. These migrations were written
  incrementally against a live database over two months, several were applied
  by hand, and replaying the set from scratch is exactly the operation you do
  not want pointed at the wrong place by a stale environment variable.
*/
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const PRODUCTION_REF = 'mjivgeojeejaszcrkbbo'

const url = process.env.TARGET_DB_URL
if (!url) {
  console.error('Set TARGET_DB_URL to the database to build up.')
  process.exit(1)
}
if (url.includes(PRODUCTION_REF)) {
  console.error('Refusing to run: TARGET_DB_URL names the production project.')
  process.exit(1)
}

const dir = 'supabase/migrations'
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

;(async () => {
  const client = new Client({ connectionString: url })
  await client.connect()

  await client.query('create schema if not exists supabase_migrations')
  await client.query(
    `create table if not exists supabase_migrations.schema_migrations (
       version text primary key, statements text[], name text)`,
  )

  const done = new Set(
    (await client.query('select version from supabase_migrations.schema_migrations')).rows.map(
      (r) => r.version,
    ),
  )

  let applied = 0
  for (const file of files) {
    const version = file.slice(0, 14)
    if (done.has(version)) continue
    const name = path.basename(file, '.sql').slice(15)
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')

    await client.query('begin')
    try {
      await client.query(sql)
      await client.query(
        'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1,$2,$3)',
        [version, name, [sql]],
      )
      await client.query('commit')
      applied += 1
      if (applied % 25 === 0) console.log('  ...' + applied + ' applied, at ' + version)
    } catch (e) {
      await client.query('rollback')
      console.error('\nSTOPPED at ' + file)
      console.error('  ' + e.message)
      console.error('\n' + applied + ' migrations applied before this one. Fix it and re-run.')
      await client.end()
      process.exit(1)
    }
  }

  console.log('done: ' + applied + ' applied this run, ' + files.length + ' total in the tree')
  await client.end()
})().catch((e) => {
  console.error('ERROR: ' + e.message)
  process.exit(1)
})
