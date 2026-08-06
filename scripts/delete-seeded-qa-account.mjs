/**
 * Removes the throwaway account the dashboard rework was designed against.
 *
 * `qa-dash@example.invalid` was seeded on 2026-08-06 with 81 ledger entries,
 * a Gold subscription and a balance, purely so the Home screen had a statement
 * long enough to test run-collapsing, a sparkline with a shape, and a tier
 * card that was not the free tier. It has served its purpose and it is now the
 * only fake account in a project that is about to take test users.
 *
 * WHY A SCRIPT AND NOT A MIGRATION, and why not one `delete from auth.users`:
 *
 *   - A migration describes a change of SHAPE and runs on every database it is
 *     applied to. This is a deliberate act on one row of one project's data.
 *   - `points_ledger` refuses DELETE from every role, owner included, until
 *     its append-only trigger is disabled. A cascade from `auth.users` is
 *     still a DELETE, so the cascade would raise. The trigger comes off for
 *     exactly one statement and goes back on in a `finally` — leaving it off
 *     would quietly retire the guarantee that history cannot be rewritten.
 *   - The account is matched by EMAIL, not by a pasted id. An id in a script
 *     is a number nobody can check; `qa-dash@example.invalid` is a name that
 *     says what it is, and `.invalid` is reserved by RFC 2606 so it can never
 *     collide with a real address.
 *
 * Refuses to touch more than one account, and refuses anything that is not on
 * the `example.invalid` domain.
 *
 *   node --env-file=.env.local scripts/delete-seeded-qa-account.mjs [email] --yes
 *
 * The address is an argument so the same guarded delete can clean up any
 * throwaway a QA pass needed — but ONLY on `.invalid`, which RFC 2606 reserves
 * and which can therefore never be a real person's address.
 */
import { Client } from 'pg'

const EMAIL = process.argv.find((a) => a.includes('@')) ?? 'qa-dash@example.invalid'
const CONFIRMED = process.argv.includes('--yes')

if (!EMAIL.endsWith('.invalid')) {
  console.error(`Refusing: ${EMAIL} is not a reserved throwaway address.`)
  process.exit(1)
}

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

await db.connect()

try {
  const { rows: found } = await db.query(
    `select id, email from auth.users where email = $1`,
    [EMAIL],
  )

  if (found.length === 0) {
    console.log(`Nothing to do — ${EMAIL} is not in this database.`)
    process.exit(0)
  }
  if (found.length > 1) {
    throw new Error(`${found.length} accounts share that email. Refusing to guess.`)
  }
  if (!found[0].email.endsWith('.invalid')) {
    throw new Error('That is not a throwaway address. Refusing.')
  }

  const id = found[0].id

  /* Everything this account touches, counted before and after, so "it is gone"
     is something the run proves rather than asserts. */
  const TOUCHES = [
    ['points_ledger', 'user_id'],
    ['user_subscriptions', 'user_id'],
    ['subscription_payments', 'user_id'],
    ['redemptions', 'user_id'],
    ['ad_attempts', 'user_id'],
    ['user_ad_state', 'user_id'],
    ['daily_earning_counters', 'user_id'],
    ['user_balances', 'user_id'],
    ['notifications', 'user_id'],
    ['user_roles', 'user_id'],
    ['fraud_signals', 'user_id'],
    ['profiles', 'id'],
  ]

  const tally = async () => {
    const out = {}
    for (const [table, column] of TOUCHES) {
      const { rows } = await db.query(
        `select count(*)::int n from public.${table} where ${column} = $1`,
        [id],
      )
      if (rows[0].n > 0) out[table] = rows[0].n
    }
    return out
  }

  const before = await tally()
  console.log(`${EMAIL}  (${id})`)
  for (const [table, n] of Object.entries(before)) console.log(`  ${table}: ${n}`)

  if (!CONFIRMED) {
    console.log('\nNothing was changed. Re-run with --yes to actually delete it.')
    process.exit(0)
  }

  await db.query('begin')

  /* Off for one statement, back on immediately — see the note at the top. */
  await db.query(`alter table public.points_ledger disable trigger user`)
  try {
    await db.query(`delete from public.points_ledger where user_id = $1`, [id])
  } finally {
    await db.query(`alter table public.points_ledger enable trigger user`)
  }

  /* Everything else hangs off auth.users with ON DELETE CASCADE. */
  await db.query(`delete from auth.users where id = $1`, [id])

  await db.query('commit')

  const after = await tally()
  const { rows: stillThere } = await db.query(
    `select count(*)::int n from auth.users where id = $1`,
    [id],
  )
  const { rows: triggers } = await db.query(
    `select count(*)::int n from pg_trigger
      where tgrelid = 'public.points_ledger'::regclass and tgenabled <> 'O' and not tgisinternal`,
  )

  const leftovers = Object.entries(after)
  for (const [table, n] of leftovers) console.log(`  ${table}: ${n}  !! NOT GONE`)

  console.log(`\naccount rows remaining: ${stillThere[0].n}`)
  console.log(`disabled ledger triggers: ${triggers[0].n}`)

  if (leftovers.length > 0 || stillThere[0].n !== 0 || triggers[0].n !== 0) {
    console.error('\nThe delete did not finish cleanly.')
    process.exitCode = 1
  } else {
    console.log('\nGone. No other account was touched.')
  }
} catch (error) {
  await db.query('rollback').catch(() => {})
  console.error('FAILED —', error.message)
  process.exitCode = 1
} finally {
  await db.end()
}
