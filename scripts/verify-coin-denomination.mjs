/**
 * Operator rule: a crypto payout is denominated in the coin. Cedis are for
 * mobile money.
 *
 * Files one real crypto redemption and one real mobile-money redemption
 * through `request_redemption`, then asserts what each surface would show.
 * Runs entirely in a transaction that is rolled back — nothing persists, and
 * no user is created that the append-only ledger would then refuse to delete.
 */
import { Client } from 'pg'

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

await db.connect()
await db.query('begin')

try {
  // A user with both destinations, past the payout-details cool-off, and
  // enough points to clear the tier minimum.
  const { rows: u } = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
             'authenticated','authenticated',
             'coin-check-' || substr(gen_random_uuid()::text,1,8) || '@test.invalid',
             'x', now(), jsonb_build_object('full_name','Coin Check'),
             now() - interval '120 days', now())
     returning id`,
  )
  const userId = u[0].id

  await db.query(`select public.credit_points($1, 300000, 'admin_adjustment', 'test', 'coin')`, [
    userId,
  ])

  const { rows: coin } = await db.query(
    `select c.id coin_id, c.code, n.id network_id
       from public.payout_coins c
       join public.payout_coin_networks n on n.coin_id = c.id
      where c.code = 'USDT' limit 1`,
  )
  const { rows: prov } = await db.query(
    `select id from public.payout_providers where is_active limit 1`,
  )

  await db.query(
    `insert into public.user_payout_details
       (user_id, method, coin_id, network_id, wallet_address, last_changed_at)
     values ($1,'crypto',$2,$3,'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', now() - interval '30 days')`,
    [userId, coin[0].coin_id, coin[0].network_id],
  )
  await db.query(
    `insert into public.user_payout_details
       (user_id, method, provider_id, msisdn, account_name, last_changed_at)
     values ($1,'mobile_money',$2,'0241234567','Coin Check', now() - interval '30 days')`,
    [userId, prov[0].id],
  )

  // ---- The two requests ------------------------------------------------
  /*
    `select * from f(...)`, never `select (f(...)).*`.

    Postgres expands a composite `(f(x)).*` by calling f ONCE PER OUTPUT
    COLUMN — six columns here, so six redemptions and six debits, which
    surfaced as "Insufficient points balance" on a balance that should have
    been plenty. Worth remembering: on a money function that is six real
    withdrawals, not a slow query.
  */
  const { rows: cryptoReq } = await db.query(
    `select * from public.request_redemption($1, 'crypto', 100000)`,
    [userId],
  )
  const { rows: momoReq } = await db.query(
    `select * from public.request_redemption($1, 'mobile_money', 100000)`,
    [userId],
  )

  const row = async (id) =>
    (
      await db.query(
        `select method, currency_amount, coin_amount, coin_usd, usd_ghs, quoted_at,
                snapshot_coin_code
           from public.redemptions where id = $1`,
        [id],
      )
    ).rows[0]

  const c = await row(cryptoReq[0].redemption_id ?? cryptoReq[0].id)
  const m = await row(momoReq[0].redemption_id ?? momoReq[0].id)

  // GHS 100 at ~11.68 / ~0.999 is ~8.57 USDT.
  check(
    'a crypto request records the coin amount',
    c.coin_amount !== null && Number(c.coin_amount) > 8 && Number(c.coin_amount) < 9,
    `${c.coin_amount} ${c.snapshot_coin_code} for GHS ${c.currency_amount}`,
  )
  check(
    'it freezes the rates it used',
    c.coin_usd !== null && c.usd_ghs !== null && c.quoted_at !== null,
    `usd_ghs ${c.usd_ghs}, coin_usd ${c.coin_usd}`,
  )
  check(
    'a mobile money request records NO coin amount',
    m.coin_amount === null && m.coin_usd === null && m.usd_ghs === null,
    `cedis only: GHS ${m.currency_amount}`,
  )

  // The constraint, not just the current behaviour.
  let refused = false
  try {
    await db.query('savepoint s')
    await db.query(
      `update public.redemptions set coin_amount = 5 where id = $1`,
      [momoReq[0].redemption_id ?? momoReq[0].id],
    )
  } catch {
    refused = true
  } finally {
    await db.query('rollback to savepoint s')
  }
  check('a cedi payout cannot be given a coin amount', refused)

  // ---- What the admin queue hands the screen ---------------------------
  const { rows: queue } = await db.query(
    `select method, ghs, coin_code, coin_amount, live_coin_amount, quoted_at
       from public.admin_list_redemptions()
      where user_id = $1`,
    [userId],
  )
  const qc = queue.find((q) => q.method === 'crypto')
  const qm = queue.find((q) => q.method === 'mobile_money')

  check(
    'the payout queue hands the operator a coin amount to send',
    qc && qc.coin_amount !== null && qc.coin_code === 'USDT',
    qc ? `${qc.coin_amount} ${qc.coin_code} (was: GHS ${qc.ghs} and nothing else)` : 'no crypto row',
  )
  check(
    'it does not invent a live quote when one was frozen',
    qc && qc.live_coin_amount === null,
    'live fallback correctly unused',
  )
  check('a mobile money row carries no coin fields', qm && qm.coin_amount === null && qm.coin_code === null)

  // ---- The fallback, when nothing was frozen ---------------------------
  await db.query(`update public.redemptions set coin_amount = null, quoted_at = null where id = $1`, [
    cryptoReq[0].redemption_id ?? cryptoReq[0].id,
  ])
  const { rows: q2 } = await db.query(
    `select coin_amount, live_coin_amount, quoted_at from public.admin_list_redemptions()
      where user_id = $1 and method = 'crypto'`,
    [userId],
  )
  check(
    'with nothing frozen, the queue quotes live so the operator still has a figure',
    q2[0].coin_amount === null && q2[0].live_coin_amount !== null && q2[0].quoted_at === null,
    `live ${q2[0].live_coin_amount} USDT, flagged by quoted_at being null`,
  )

  console.log('')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  await db.query('rollback')
  await db.end()
  console.log('(rolled back — nothing persisted)')
}
