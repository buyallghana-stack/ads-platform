/*
  Applies one migration file and records it in the ledger, in a single
  transaction, rolling back if anything raises.

    node scripts/apply-migration.cjs <migration filename>

  Why this exists: migrations on this project are applied by hand against the
  hosted database rather than through `supabase db push`, and doing that in a
  shell one-liner is how a half-applied migration happens. This does the whole
  thing or none of it, and refuses to apply the same version twice.

  It lives in the repo rather than a temp directory so `require('pg')`
  resolves from node_modules without NODE_PATH games.
*/
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: node scripts/apply-migration.cjs <migration filename>')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]
    }),
)

/*
  ⚠️ TARGETS PRODUCTION, AND SAYS SO BEFORE IT ACTS.

  `SUPABASE_DB_URL` is the TEST database now, because that is what the suite
  reads. A migration runner that quietly followed it would report "already
  applied" after the replay had put the version in the test ledger, and
  production would silently never receive it. That happened once.

  So the live database is named separately, and the project ref is printed
  before anything runs. The test database is not kept up to date by this
  script; `scripts/replay-migrations.cjs` does that.
*/
const target = env.PRODUCTION_DB_URL || env.SUPABASE_DB_URL
if (!target) {
  console.error('Neither PRODUCTION_DB_URL nor SUPABASE_DB_URL is in .env.local')
  process.exit(1)
}
const ref = (target.match(/postgres\.([a-z0-9]+)/) || [])[1] || 'unknown project'

const file = path.join('supabase', 'migrations', path.basename(arg))
if (!fs.existsSync(file)) {
  console.error('No such migration: ' + file)
  process.exit(1)
}

const sql = fs.readFileSync(file, 'utf8')
const base = path.basename(file, '.sql')
const version = base.slice(0, 14)
const name = base.slice(15)

;(async () => {
  console.log('target: ' + ref)
  const client = new Client({ connectionString: target })
  await client.connect()
  try {
    const already = await client.query(
      'select 1 from supabase_migrations.schema_migrations where version = $1',
      [version],
    )
    if (already.rowCount) {
      console.log('Already applied, nothing to do: ' + version)
      return
    }

    await client.query('begin')
    try {
      await client.query(sql)
      await client.query(
        'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
        [version, name, [sql]],
      )
      await client.query('commit')
      console.log('APPLIED ' + version + '  ' + name)
    } catch (e) {
      await client.query('rollback')
      console.error('FAILED, rolled back: ' + e.message)
      process.exitCode = 1
    }
  } finally {
    await client.end()
  }
})().catch((e) => {
  console.error('ERROR: ' + e.message)
  process.exit(1)
})
