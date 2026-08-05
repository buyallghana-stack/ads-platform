/**
 * A clean slate: every point, purchase, payout and bit of progress removed,
 * with the ACCOUNTS left standing.
 *
 * Operator, 2026-08-04, on moving to flexible pricing: *"no account is a real
 * account now, just test accounts… I also want you to clear previous
 * subscription purchase, points accumulated, so basically a fresh start
 * because of the new implementation."*
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION. A migration describes how the
 * SHAPE of the database changes and runs everywhere it is applied. This is a
 * deliberate act on one project's data, and it must never happen twice by
 * accident or on a database that has real customers on it. So it is a
 * separate, guarded, explicit thing.
 *
 * ORDER MATTERS, and most of it is not obvious:
 *   - `points_ledger` refuses DELETE from every role, including the owner,
 *     until its append-only trigger is disabled — the trigger goes back on in
 *     a `finally`, because leaving it off would silently retire the guarantee
 *     that history cannot be rewritten.
 *   - `redemptions` and `subscription_payments` are ON DELETE RESTRICT against
 *     the user, so they go before anything that would cascade.
 *   - `ads.completions_count` is a counter, not a derived value, so it has to
 *     be put back by hand or every ad still believes it has been watched.
 *
 *   node --env-file=.env.local scripts/reset-earning-data.mjs --yes
 */
import { Client } from 'pg'

const CONFIRMED = process.argv.includes('--yes')

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

/* Emptied entirely: none of these mean anything without the money they
   describe, and half of them are ON DELETE RESTRICT against accounts we are
   keeping. */
const TABLES = [
  'redemptions',
  'subscription_payments',
  'user_subscriptions',
  'referral_commissions',
  'task_completions',
  'game_plays',
  'gift_code_redemptions',
  'gift_code_attempts',
  'ad_attempts',
  'user_ad_state',
  'daily_earning_counters',
  'daily_issuance',
  'fraud_signals',
  'user_risk_scores',
  'user_balances',
  'notifications',
  'system_alerts',
]

await db.connect()

const count = async (table) => {
  const { rows } = await db.query(`select count(*)::int n from public.${table}`)
  return rows[0].n
}

try {
  const before = {}
  for (const table of [...TABLES, 'points_ledger']) before[table] = await count(table)
  const { rows: ads } = await db.query(
    `select count(*)::int n, coalesce(sum(completions_count), 0)::int c from public.ads`,
  )
  const { rows: users } = await db.query(`select count(*)::int n from auth.users`)

  console.log('before:')
  for (const [table, n] of Object.entries(before)) if (n > 0) console.log(`  ${table}: ${n}`)
  console.log(`  ads: ${ads[0].n} (${ads[0].c} completions recorded)`)
  console.log(`  accounts: ${users[0].n} — kept\n`)

  if (!CONFIRMED) {
    console.log('Nothing was changed. Re-run with --yes to actually clear it.')
    process.exit(0)
  }

  await db.query('begin')

  for (const table of TABLES) {
    await db.query(`delete from public.${table}`)
  }

  /* The append-only trigger is the reason the ledger can be trusted, so it
     comes off for exactly one statement and goes straight back on. */
  await db.query(`alter table public.points_ledger disable trigger user`)
  try {
    await db.query(`delete from public.points_ledger`)
  } finally {
    await db.query(`alter table public.points_ledger enable trigger user`)
  }

  // A counter, not a derived value — nothing else would put it back.
  await db.query(`update public.ads set completions_count = 0 where completions_count <> 0`)

  await db.query('commit')

  console.log('after:')
  let dirty = 0
  for (const table of [...TABLES, 'points_ledger']) {
    const n = await count(table)
    if (n > 0) {
      console.log(`  ${table}: ${n}  !! NOT EMPTY`)
      dirty += n
    }
  }
  const { rows: adsAfter } = await db.query(
    `select coalesce(sum(completions_count), 0)::int c from public.ads`,
  )
  const { rows: triggers } = await db.query(
    `select count(*)::int n from pg_trigger
      where tgrelid = 'public.points_ledger'::regclass and tgenabled <> 'O' and not tgisinternal`,
  )
  const { rows: usersAfter } = await db.query(`select count(*)::int n from auth.users`)

  console.log(`  ad completions: ${adsAfter[0].c}`)
  console.log(`  disabled ledger triggers: ${triggers[0].n}`)
  console.log(`  accounts still here: ${usersAfter[0].n}`)

  if (dirty > 0 || adsAfter[0].c !== 0 || triggers[0].n !== 0) {
    console.error('\nThe reset did not finish cleanly.')
    process.exitCode = 1
  } else {
    console.log('\nClean slate. Accounts, ads, plans and settings are untouched.')
  }
} catch (error) {
  await db.query('rollback').catch(() => {})
  console.error('FAILED —', error.message)
  process.exitCode = 1
} finally {
  await db.end()
}
