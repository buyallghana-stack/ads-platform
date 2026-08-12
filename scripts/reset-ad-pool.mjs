/**
 * Empties the ad pool. The operator stocks it again by hand.
 *
 * Operator, 2026-08-12, straight after the user data reset: *"delete the
 * existing ads too. i will add them myself."* Which follows — the buckets are
 * exclusive now, so the eleven untagged ads that served everybody are exactly
 * what the new per-plan stocking replaces.
 *
 * ── WHAT GOES, AND WHAT COMES WITH IT ──
 *
 * Every row in `ads`, of every status. Everything beneath an ad is ON DELETE
 * CASCADE and leaves with it: its questions, their options, the branching
 * rules, its plan targeting, its link clicks, and any watch state or attempt
 * still pointing at it. That is one statement, not seven, and the cascade is
 * the schema's own guarantee rather than an order this script has to get right.
 *
 * ── WHAT IS DELIBERATELY KEPT ──
 *
 *   ADVERTISERS, unless `--advertisers` is passed. They are companies rather
 *   than creative, so new ads usually attach to the same names. The operator
 *   asked for them too on 2026-08-12 ("let the advertisers go"), which takes
 *   their payment records with them by cascade — hence a separate flag rather
 *   than a quiet extra delete.
 *
 *   THE MEDIA IN STORAGE. Thumbnails and uploaded videos live in a bucket, not
 *   in this table, so deleting rows orphans the files rather than removing
 *   them. Harmless and cheap, but say so rather than let somebody discover a
 *   bucket that only grows.
 *
 *   node --env-file=.env.local scripts/reset-ad-pool.mjs        # dry run
 *   node --env-file=.env.local scripts/reset-ad-pool.mjs --yes  # do it
 *
 * Backed up to the Desktop first, ads and their questions together, because
 * "I will add them myself" is easier with the old copy open beside you.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { Client } from 'pg'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const CONFIRMED = process.argv.includes('--yes')
const ADVERTISERS = process.argv.includes('--advertisers')
const BACKUP_DIR =
  process.env.RESET_BACKUP_DIR ?? '/mnt/c/Users/Emmanuel Ofori/Desktop/sideperks-backup'

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const count = async (table) => {
  const { rows } = await db.query(`select count(*)::int n from public.${table}`)
  return rows[0].n
}

await db.connect()

try {
  const CASCADES = [
    'ads',
    'ad_questions',
    'ad_question_options',
    'ad_question_rules',
    'ad_tiers',
    'ad_link_clicks',
    'ad_attempts',
    'user_ad_state',
  ]

  const before = {}
  for (const table of CASCADES) before[table] = await count(table)

  const { rows: pool } = await db.query(
    `select status::text, format::text, count(*)::int n
       from public.ads group by 1, 2 order by 1, 2`,
  )

  console.log('THE POOL')
  for (const row of pool) console.log(`  ${row.status.padEnd(10)} ${row.format.padEnd(8)} ${row.n}`)
  console.log('\nDELETED WITH IT (cascade)')
  for (const table of CASCADES.slice(1)) {
    if (before[table] > 0) console.log(`  ${table.padEnd(24)} ${before[table]}`)
  }
  if (ADVERTISERS) {
    console.log('\nADVERTISERS TOO (--advertisers)')
    console.log(`  advertisers              ${await count('advertisers')}`)
    console.log(`  advertiser_payments      ${await count('advertiser_payments')}  (cascade)`)
  } else {
    console.log('\nKEPT')
    console.log(`  advertisers              ${await count('advertisers')}`)
    console.log(`  advertiser_payments      ${await count('advertiser_payments')}`)
  }

  if (!CONFIRMED) {
    console.log('\nDry run. Nothing was changed. Re-run with --yes to do it.')
    process.exit(0)
  }

  /* The old pool, saved where the operator can read it while rebuilding. The
     questions carry their answer key, so this file is worth keeping private. */
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = `${BACKUP_DIR}/${stamp}-ads`
  mkdirSync(dir, { recursive: true })

  const dump = {}
  const backed = ['ads', 'ad_questions', 'ad_question_options', 'ad_question_rules', 'ad_tiers']
  if (ADVERTISERS) backed.push('advertisers', 'advertiser_payments')
  for (const table of backed) {
    const { rows } = await db.query(`select * from public.${table}`)
    dump[table] = rows
  }
  writeFileSync(`${dir}/ad-pool-backup.json`, JSON.stringify(dump, null, 2))
  console.log(`\nbacked up to ${dir}`)

  await db.query('begin')
  try {
    await db.query(`delete from public.ads`)
    /* `ads.advertiser_id` is ON DELETE SET NULL and the pool is already gone,
       so nothing is left pointing here; `advertiser_payments` cascades. */
    if (ADVERTISERS) await db.query(`delete from public.advertisers`)
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }

  console.log('\nAFTER')
  let dirty = 0
  for (const table of ADVERTISERS ? [...CASCADES, 'advertisers', 'advertiser_payments'] : CASCADES) {
    const n = await count(table)
    console.log(`  ${table.padEnd(24)} ${n}${n > 0 ? '  !! NOT EMPTY' : ''}`)
    if (n > 0) dirty += 1
  }

  if (dirty > 0) {
    console.error('\nSomething did not clear.')
    process.exitCode = 1
  } else {
    console.log('\nThe pool is empty. Every bucket on /admin/ads now reads 0 and warns.')
  }
} finally {
  await db.end()
}
