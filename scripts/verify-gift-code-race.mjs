/**
 * The one property that matters: a gift code cannot be redeemed twice, even
 * when two people submit it at the same instant.
 *
 * WHY THIS IS NOT IN THE VITEST SUITE
 * `withRollback` gives every test one transaction that is thrown away, which
 * is what makes the suite safe to run against a shared database. Two
 * transactions cannot race inside one transaction, so a genuine concurrency
 * test needs two connections and a real COMMIT — which that harness explicitly
 * cannot do. This script does it, and cleans up after itself.
 *
 * WHAT IT PROVES, IN ORDER
 *   1. Connection B BLOCKS while A holds the row lock. That is the FOR UPDATE
 *      doing its job: the two redemptions serialise instead of both reading
 *      status = 'active'.
 *   2. Once A commits, B returns already_used rather than paying out again.
 *   3. Exactly one redemption row and one ledger credit exist afterwards.
 *
 * CLEANUP: the append-only trigger on points_ledger refuses DELETE to every
 * role including the owner, so the fixture's credit is purged the documented
 * way — disable trigger, delete, re-enable. Nothing is left behind.
 */
import { Client } from 'pg'

const connect = async () => {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  return c
}

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const setup = await connect()
const a = await connect()
const b = await connect()

let codeId = null
let codeText = null
const userIds = []

try {
  // ---- Fixtures, committed, because the point is to race real rows -------
  const mkUser = async (label) => {
    const { rows } = await setup.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
               'authenticated','authenticated',
               'race-${label}-' || substr(gen_random_uuid()::text,1,8) || '@test.invalid',
               'x', now(), jsonb_build_object('full_name','Race ${label}'), now(), now())
       returning id`,
    )
    userIds.push(rows[0].id)
    return rows[0].id
  }

  const adminId = await mkUser('admin')
  await setup.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [adminId])
  const first = await mkUser('first')
  const second = await mkUser('second')

  const { rows: gen } = await setup.query(`select public.generate_gift_code() as code`)
  codeText = gen[0].code
  const { rows: made } = await setup.query(
    `select id from public.admin_create_gift_code($1, $2, 5000, 'race check')`,
    [adminId, codeText],
  )
  codeId = made[0].id
  console.log(`fixture code ${codeText} worth 5000 pts`)

  // ---- The race ----------------------------------------------------------
  await a.query('begin')
  await b.query('begin')

  const aResult = await a.query(`select public.redeem_gift_code($1, $2) as r`, [first, codeText])
  check('the first redemption succeeds', aResult.rows[0].r.outcome === 'ok', JSON.stringify(aResult.rows[0].r))

  // B must not be able to proceed while A holds the lock. Fire it without
  // awaiting, then confirm it is still pending a moment later.
  let bSettled = false
  const bPromise = b
    .query(`select public.redeem_gift_code($1, $2) as r`, [second, codeText])
    .then((r) => {
      bSettled = true
      return r
    })

  await new Promise((r) => setTimeout(r, 1500))
  check(
    'a simultaneous redemption BLOCKS rather than reading the code as active',
    !bSettled,
    'still waiting on the row lock after 1.5s',
  )

  await a.query('commit')

  const bResult = await bPromise
  check(
    'once the first commits, the second is refused',
    bResult.rows[0].r.outcome === 'already_used',
    JSON.stringify(bResult.rows[0].r),
  )
  await b.query('commit')

  // ---- Exactly one of everything ----------------------------------------
  const { rows: counts } = await setup.query(
    `select
       (select count(*)::int from public.gift_code_redemptions where gift_code_id = $1) as redemptions,
       (select count(*)::int from public.points_ledger
         where entry_type = 'gift_code' and reference_id = $1::text)                    as credits,
       (select status::text from public.gift_codes where id = $1)                        as status,
       (select coalesce(sum(balance),0)::int from public.user_balances
         where user_id = any($2::uuid[]))                                                as total_paid`,
    [codeId, [first, second]],
  )
  const c = counts[0]

  check('exactly one redemption was recorded', c.redemptions === 1, `${c.redemptions} row(s)`)
  check('exactly one ledger credit was written', c.credits === 1, `${c.credits} entr(y/ies)`)
  check('the code is marked redeemed', c.status === 'redeemed', c.status)
  check(
    'the code paid out its value exactly once',
    c.total_paid === 5000,
    `${c.total_paid} pts across both accounts`,
  )

  console.log('')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  for (const c of [a, b]) {
    await c.query('rollback').catch(() => {})
    await c.end().catch(() => {})
  }

  // ---- Cleanup, in dependency order -------------------------------------
  try {
    if (codeId) {
      await setup.query(`delete from public.gift_code_redemptions where gift_code_id = $1`, [codeId])
    }
    if (userIds.length) {
      // The append-only trigger refuses DELETE to every role including the
      // owner. This is the documented way to purge test fixtures.
      await setup.query(`alter table public.points_ledger disable trigger user`)
      await setup.query(`delete from public.points_ledger where user_id = any($1::uuid[])`, [userIds])
      await setup.query(`alter table public.points_ledger enable trigger user`)

      await setup.query(`delete from public.user_balances where user_id = any($1::uuid[])`, [userIds])
      await setup.query(`delete from public.notifications where user_id = any($1::uuid[])`, [userIds])
      await setup.query(`delete from public.gift_code_attempts where user_id = any($1::uuid[])`, [userIds])
    }
    if (codeId) await setup.query(`delete from public.gift_codes where id = $1`, [codeId])
    if (userIds.length) {
      await setup.query(`delete from public.user_roles where user_id = any($1::uuid[])`, [userIds])
      await setup.query(`delete from auth.users where id = any($1::uuid[])`, [userIds])
    }

    const { rows: left } = await setup.query(
      `select (select count(*)::int from public.gift_codes where id = $1) as codes,
              (select count(*)::int from auth.users where id = any($2::uuid[])) as users`,
      [codeId, userIds],
    )
    console.log(`cleanup: ${left[0].codes} code(s), ${left[0].users} user(s) left behind`)
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message)
    console.error('fixture code:', codeText, 'users:', userIds.join(', '))
    process.exitCode = 1
  }
  await setup.end()
}
