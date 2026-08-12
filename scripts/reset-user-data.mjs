/**
 * A fresh start for every member, with the accounts left standing.
 *
 * Operator, 2026-08-12, after the plan ladder was repriced under people who
 * had already paid: *"delete all user data except their account. so a fresh
 * start like they just signed up. delete for both ads and affiliate."*
 * They chose the deepest scope on the ads side, and on the affiliate side the
 * one I recommended: empty everything underneath, but KEEP the affiliate
 * account rows so their codes and uplines survive.
 *
 * ── WHAT SURVIVES ──
 *
 *   the login, the profile (name, phone, avatar), staff roles,
 *   referral edges (who invited whom, which is also the affiliate upline),
 *   affiliate accounts with their CODES and parent, reset to pending,
 *   the admin audit log, and everything the operator authored:
 *   ads, products, courses, lessons, quizzes, plans, tasks, coupons.
 *
 * ── WHAT GOES ──
 *
 *   ADS, everything: points and their ledger, ad history, games, tasks, gift
 *   redemptions, referral commissions, payout requests, plans and the payments
 *   that bought them, fraud flags, notifications — AND the security setup:
 *   payout details, withdrawal PIN, 2FA, devices, sessions, support threads.
 *
 *   AFFILIATE, everything except the account row: orders, entitlements,
 *   commission, conversions, clicks, course progress, quiz attempts,
 *   certificates, coupon and gift redemptions.
 *
 * ── SAFEGUARDS, BECAUSE THIS IS NOT REVERSIBLE ──
 *
 *   1. A DRY RUN IS THE DEFAULT. It prints what it would remove and stops.
 *   2. EVERYTHING IS EXPORTED FIRST, as JSON, to the operator's Desktop —
 *      every row of every table it is about to touch. `orders` and
 *      `subscription_payments` also go out as CSV, because they are the only
 *      record of money that actually moved through Paystack.
 *   3. ONE TRANSACTION. Either all of it happens or none of it does.
 *   4. THE APPEND-ONLY LEDGERS come off for exactly one statement each and go
 *      back on in a `finally`. `points_ledger` and `commission_ledger` refuse
 *      DELETE from every role, including the owner, and leaving that guard off
 *      would quietly retire the promise that history cannot be rewritten.
 *   5. IT COUNTS AGAIN AFTERWARDS and exits non-zero if anything survived.
 *
 *   node --env-file=.env.local scripts/reset-user-data.mjs            # dry run
 *   node --env-file=.env.local scripts/reset-user-data.mjs --yes      # do it
 *
 * ⚠️ Never pipe this. A closed stdout kills the process on its next write, and
 * this one holds a transaction and two disabled triggers. Redirect to a file.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { Client } from 'pg'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const CONFIRMED = process.argv.includes('--yes')
const BACKUP_DIR =
  process.env.RESET_BACKUP_DIR ?? '/mnt/c/Users/Emmanuel Ofori/Desktop/sideperks-backup'

/*
  ORDER IS THE WHOLE DIFFICULTY. Several of these are ON DELETE RESTRICT or NO
  ACTION against a parent we are keeping, so a child that is deleted late takes
  its parent's delete down with it. Read this list as "leaves first".
*/
const AFFILIATE = [
  'commission_gift_code_redemptions',
  'commission_payouts',
  'commission_ledger', // append-only
  'conversions', // points at accounts, clicks, entitlements, programs
  'affiliate_clicks',
  'affiliate_entitlements', // points at orders and training programs
  'affiliate_task_completions',
  'affiliate_game_plays',
  'certificates',
  'quiz_attempts',
  'lesson_progress',
  'entitlements', // points at orders and products
  'coupon_redemptions',
  'orders',
]

const ADS = [
  'gift_code_redemptions',
  'gift_code_attempts',
  'task_completions',
  'game_plays',
  'ad_attempts',
  'ad_link_clicks',
  'user_ad_state',
  'redemptions',
  'referral_commissions', // points at subscription_payments and tiers
  'subscription_payments',
  'user_subscriptions',
  'points_ledger', // append-only
  'user_balances',
  'daily_earning_counters',
  'daily_issuance',
  'fraud_signals', // points at fraud_checks
  'fraud_checks',
  'user_risk_scores',
  'notifications',
  'system_alerts',
]

/* Option 3: the security setup goes too, so everybody re-does their PIN,
   payout details and 2FA. The operator chose this knowing it is a chore for
   four people; it is the only version that is honestly "as if they just
   signed up". */
const SECURITY = [
  'support_messages',
  'support_threads',
  'user_payout_details',
  'payout_detail_changes',
  'user_security',
  'user_devices',
  'user_session_records',
  'auth_signals',
]

const APPEND_ONLY = new Set(['points_ledger', 'commission_ledger'])
const ALL = [...AFFILIATE, ...ADS, ...SECURITY]

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
  /* ---- what is there now ------------------------------------------------ */
  const before = {}
  for (const table of ALL) before[table] = await count(table)

  const kept = {
    accounts: await count('profiles'),
    'affiliate accounts (codes kept)': await count('affiliate_accounts'),
    'referral edges': await count('referrals'),
    'staff roles': await count('user_roles'),
    'admin audit log': await count('admin_audit_log'),
  }

  const group = (name, tables) => {
    const rows = tables.filter((t) => before[t] > 0)
    if (rows.length === 0) return
    console.log(`\n${name}`)
    for (const t of rows) console.log(`  ${t.padEnd(34)} ${before[t]}`)
  }

  console.log('TO BE DELETED')
  group('affiliate', AFFILIATE)
  group('ads', ADS)
  group('security and sessions', SECURITY)
  console.log(`\n  total rows: ${Object.values(before).reduce((a, b) => a + b, 0)}`)

  console.log('\nKEPT')
  for (const [label, n] of Object.entries(kept)) console.log(`  ${label.padEnd(34)} ${n}`)

  if (!CONFIRMED) {
    console.log('\nDry run. Nothing was changed. Re-run with --yes to do it.')
    process.exit(0)
  }

  /* ---- the backup, before a single row goes ----------------------------- */
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = `${BACKUP_DIR}/${stamp}`
  mkdirSync(dir, { recursive: true })

  const dump = {}
  for (const table of ALL) {
    const { rows } = await db.query(`select * from public.${table}`)
    dump[table] = rows
  }
  /* The accounts themselves are not being touched, but a restore would be
     guesswork without them. */
  for (const table of ['profiles', 'affiliate_accounts', 'referrals', 'user_roles']) {
    const { rows } = await db.query(`select * from public.${table}`)
    dump[table] = rows
  }
  writeFileSync(`${dir}/full-backup.json`, JSON.stringify(dump, null, 2))

  /* Money that actually moved, in a form a spreadsheet can open. These two are
     the only record of real Paystack charges. */
  const csv = (rows) => {
    if (rows.length === 0) return ''
    const cols = Object.keys(rows[0])
    const cell = (v) =>
      v === null || v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`
    return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n')
  }
  writeFileSync(`${dir}/subscription-payments.csv`, csv(dump.subscription_payments))
  writeFileSync(`${dir}/orders.csv`, csv(dump.orders))
  console.log(`\nbacked up to ${dir}`)

  /* ---- the delete ------------------------------------------------------- */
  await db.query('begin')
  try {
    for (const table of ALL) {
      if (APPEND_ONLY.has(table)) {
        await db.query(`alter table public.${table} disable trigger user`)
        try {
          await db.query(`delete from public.${table}`)
        } finally {
          await db.query(`alter table public.${table} enable trigger user`)
        }
      } else {
        await db.query(`delete from public.${table}`)
      }
    }

    /* The affiliate account survives with its code and its upline, but it is
       no longer an ACTIVE affiliate: the training entitlement that activated
       it has just been deleted, and leaving the flag on would let somebody
       promote a course nobody has bought. Back to the column's own default. */
    await db.query(
      `update public.affiliate_accounts
          set status = 'pending', activated_at = null, updated_at = now()
        where status <> 'pending' or activated_at is not null`,
    )

    /* A counter, not a derived value: nothing else would put it back, and
       every ad would go on believing it had been watched. Coupons need no
       such fix — a use is COUNTED from `coupon_redemptions` rather than
       stored on the coupon, which is why an abandoned checkout cannot eat a
       promotion, and that table is in the list above. */
    await db.query(`update public.ads set completions_count = 0 where completions_count <> 0`)

    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }

  /* ---- and it has to be true afterwards --------------------------------- */
  console.log('\nAFTER')
  let dirty = 0
  for (const table of ALL) {
    const n = await count(table)
    if (n > 0) {
      console.log(`  ${table.padEnd(34)} ${n}  !! NOT EMPTY`)
      dirty += 1
    }
  }
  const { rows: triggers } = await db.query(
    `select count(*)::int n from pg_trigger
      where tgrelid in ('public.points_ledger'::regclass, 'public.commission_ledger'::regclass)
        and tgenabled <> 'O' and not tgisinternal`,
  )
  console.log(`  disabled append-only triggers: ${triggers[0].n}`)

  console.log('\nSTILL STANDING')
  for (const [label, n] of Object.entries({
    accounts: await count('profiles'),
    'affiliate accounts': await count('affiliate_accounts'),
    'referral edges': await count('referrals'),
    'staff roles': await count('user_roles'),
  })) {
    console.log(`  ${label.padEnd(34)} ${n}`)
  }

  if (dirty > 0 || triggers[0].n > 0) {
    console.error('\nSomething did not clear. The backup is on the Desktop.')
    process.exitCode = 1
  } else {
    console.log('\nDone. Every account is a signed-up member who has bought nothing.')
  }
} finally {
  await db.end()
}
