/*
  Which migrations the live database is missing.

    node scripts/check-migrations.cjs

  Read only. It opens `PRODUCTION_DB_URL`, reads
  `supabase_migrations.schema_migrations`, and compares it against the files in
  `supabase/migrations`. Nothing is written and nothing is applied.

  WHY THIS EXISTS. Migrations here are applied by hand, one at a time, against
  a hosted database. The failure that produces is not a loud one: a file is
  committed, the deploy goes out, and the function the new code calls is the
  old function. It has already happened once on this project, when
  `SUPABASE_DB_URL` became the TEST database and a runner that followed it
  reported "already applied" while production silently received nothing.

  So the question "is the live database in step with the repository" should be
  answerable in four seconds by anybody, rather than by reasoning about which
  script read which variable on which day.

  It prints three things:
    * files on disk that the live ledger has never seen  (the dangerous set)
    * ledger rows with no file behind them               (usually a rename)
    * the last few applied, so the tail is visible
*/
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

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

/* Same rule as the apply runner: the LIVE database is named separately, and
   SUPABASE_DB_URL is only a fallback for a checkout that has no production
   string at all. Following the wrong one is the whole bug this guards. */
const target = env.PRODUCTION_DB_URL || env.SUPABASE_DB_URL
if (!target) {
  console.error('Neither PRODUCTION_DB_URL nor SUPABASE_DB_URL is in .env.local')
  process.exit(1)
}
const ref = (target.match(/postgres\.([a-z0-9]+)/) || [])[1] || 'unknown project'

const onDisk = fs
  .readdirSync(path.join('supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({ version: f.slice(0, 14), name: f.slice(15, -4), file: f }))
  .sort((a, b) => a.version.localeCompare(b.version))

;(async () => {
  console.log('target: ' + ref)
  const client = new Client({ connectionString: target })
  await client.connect()
  try {
    const { rows } = await client.query(
      'select version, name from supabase_migrations.schema_migrations order by version',
    )
    const applied = new Set(rows.map((r) => r.version))
    const files = new Set(onDisk.map((m) => m.version))

    const missing = onDisk.filter((m) => !applied.has(m.version))
    const orphans = rows.filter((r) => !files.has(r.version))

    console.log(`\n${onDisk.length} files on disk, ${rows.length} rows in the ledger`)

    if (missing.length === 0) {
      console.log('\nNothing missing. The live database is in step with the repository.')
    } else {
      console.log(`\n⚠️  ${missing.length} NOT APPLIED to ${ref}:`)
      for (const m of missing) console.log('   ' + m.file)
      console.log('\n   node scripts/apply-migration.cjs <filename>   applies one, in a transaction.')
    }

    if (orphans.length > 0) {
      console.log(`\n${orphans.length} in the ledger with no file (renamed, or applied by hand):`)
      for (const r of orphans) console.log('   ' + r.version + '  ' + r.name)
    }

    console.log('\nLast five applied:')
    for (const r of rows.slice(-5)) console.log('   ' + r.version + '  ' + r.name)
  } finally {
    await client.end()
  }
})().catch((e) => {
  console.error('ERROR: ' + e.message)
  process.exit(1)
})
