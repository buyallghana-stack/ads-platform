import { Client } from 'pg'

/**
 * The harness the money-critical tests run on.
 *
 * WHY A DIRECT POSTGRES CONNECTION AND NOT THE SUPABASE CLIENT
 * Almost every function these tests exercise — credit_points, debit_points,
 * request_redemption, approve_redemption, mark_redemption_paid — is revoked
 * from every client-reachable role. That is the property that makes them
 * worth having, and it means a test that reached them through a browser-shaped
 * client would be testing a door that is supposed to be locked. These connect
 * as the database owner, which is the only caller that can drive the whole
 * pipeline.
 *
 * WHY EVERY TEST IS A TRANSACTION THAT IS THROWN AWAY
 * There is no local Postgres on this machine (no Docker, no Supabase CLI), so
 * these run against the shared dev project. That makes cleanup the hard part,
 * not the tests: `points_ledger` is append-only by trigger and refuses DELETE
 * to every role including the owner, and any user with ledger rows cannot be
 * removed at all (ON DELETE RESTRICT, migration 007). A test that inserted
 * money and then tried to tidy up after itself would be permanently wedged
 * after its first run.
 *
 * So nothing is ever cleaned up: `withRollback` opens a transaction, hands it
 * to the test, and rolls it back whatever happens. Fixtures, ledger entries,
 * redemptions and config changes all disappear together, and the append-only
 * trigger is never asked to permit something it exists to refuse.
 *
 * The consequence to remember when writing tests: everything inside one
 * `withRollback` shares a transaction, so tests cannot run in parallel
 * against the same rows and nothing inside can commit. Any test that needs to
 * observe a real commit is in the wrong harness.
 */

const CONNECTION = process.env.SUPABASE_DB_URL

export const HAS_DB = Boolean(CONNECTION)

/** What a test gets: a connected client already inside a transaction. */
export type Tx = Client

/**
 * Runs `body` inside a transaction and rolls it back.
 *
 * The rollback is in a `finally`, so a failing assertion cleans up exactly as
 * thoroughly as a passing one. A test that fails halfway through a redemption
 * must not leave half a redemption behind.
 */
export async function withRollback<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  if (!CONNECTION) {
    throw new Error(
      'SUPABASE_DB_URL is not set. These tests talk to Postgres directly — ' +
        'see tests/README.md for where to get the connection string.',
    )
  }

  const client = new Client({
    connectionString: CONNECTION,
    // Supabase terminates TLS with its own chain. Verification is off because
    // the alternative is shipping their CA bundle into the repo for a test
    // harness; the connection is still encrypted.
    ssl: { rejectUnauthorized: false },
    statement_timeout: 15_000,
  })

  await client.connect()
  try {
    await client.query('begin')
    return await body(client)
  } finally {
    try {
      await client.query('rollback')
    } finally {
      await client.end()
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

export type TestUser = { id: string; email: string }

/**
 * A signed-up user, made the way the application makes one.
 *
 * Inserting into `auth.users` rather than into `profiles` on purpose: the
 * `handle_new_user` trigger is what creates the profile and allocates the
 * referral code, and a fixture that wrote the profile directly would be
 * testing against a user shape the real signup never produces.
 */
export async function createUser(
  tx: Tx,
  options: { name?: string; phone?: string; joinedDaysAgo?: number } = {},
): Promise<TestUser> {
  const { name = 'Test User', phone = null, joinedDaysAgo = 90 } = options

  const { rows } = await tx.query<{ id: string; email: string }>(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     values (
       gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated',
       'test-' || substr(gen_random_uuid()::text, 1, 12) || '@test.invalid',
       'not-a-real-password', now(),
       jsonb_build_object('full_name', $1::text, 'phone', $2::text),
       now() - make_interval(days => $3::int), now())
     returning id, email`,
    [name, phone, joinedDaysAgo],
  )

  return rows[0]!
}

/** A user who is also an administrator, for the functions that demand one. */
export async function createAdmin(tx: Tx): Promise<TestUser> {
  const admin = await createUser(tx, { name: 'Test Admin', joinedDaysAgo: 200 })
  await tx.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [admin.id])
  return admin
}

/** Points into a user's balance, through the only function that may do it. */
export async function creditPoints(tx: Tx, userId: string, amount: number): Promise<void> {
  await tx.query(`select public.credit_points($1, $2, 'ad_view')`, [userId, amount])
}

export async function balanceOf(tx: Tx, userId: string): Promise<number> {
  const { rows } = await tx.query<{ balance: string }>(
    `select balance from public.user_balances where user_id = $1`,
    [userId],
  )
  return rows.length === 0 ? 0 : Number(rows[0]!.balance)
}

/**
 * Mobile money details, ready to redeem against.
 *
 * Two things have to be true before `request_redemption` will accept them and
 * neither is the test's subject, so both are arranged here: the provider must
 * be active, and the details must be older than
 * `payout_details_change_cooloff_hours` — the anti-takeover delay that would
 * otherwise refuse every request a test makes seconds after saving them.
 */
export async function givePayoutDetails(
  tx: Tx,
  userId: string,
  options: { msisdn?: string; accountName?: string } = {},
): Promise<void> {
  const { msisdn = '0244000111', accountName = 'Test User' } = options

  await tx.query(
    `update public.payout_providers
        set rail_confirmed = true, is_active = true
      where code = 'MTN_MOMO'`,
  )

  await tx.query(
    `select public.set_payout_details(
       $1, 'mobile_money', null, null, null,
       (select id from public.payout_providers where code = 'MTN_MOMO'),
       $2, $3)`,
    [userId, msisdn, accountName],
  )

  await tx.query(
    `update public.user_payout_details
        set last_changed_at = now() - interval '400 hours'
      where user_id = $1`,
    [userId],
  )
}

/** Sets a config value for the length of the transaction only. */
export async function setConfig(tx: Tx, key: string, value: string): Promise<void> {
  await tx.query(`update public.app_config set value = $2 where key = $1`, [key, value])
}

/**
 * Makes `auth.uid()` return this user for the rest of the transaction.
 *
 * Most functions under test are revoked from client roles and take the user
 * id as an argument, which is why the harness connects as the owner and never
 * needed this. The self-scoped ones are different: `get_leaderboard` and
 * `get_leaderboard_standing` are granted to `authenticated` precisely BECAUSE
 * they read the caller's identity rather than trusting a parameter, so a test
 * that cannot set an identity cannot test them at all.
 *
 * `auth.uid()` reads `request.jwt.claims`, and the `true` third argument makes
 * the setting local to the transaction — so it disappears with the rollback
 * like everything else.
 */
export async function actAs(tx: Tx, userId: string): Promise<void> {
  await tx.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`, [
    userId,
  ])
}

/**
 * The same, for somebody the database will treat as an administrator.
 *
 * `is_admin()` does NOT read `public.user_roles` — it reads the `user_role`
 * claim, which Supabase's auth hook stamps into the token at sign-in. So
 * `createAdmin` (which writes the table row) plus `actAs` (which sets only
 * `sub`) produces a session that is an admin in the data and an ordinary user
 * to every policy and every SECURITY DEFINER check. That combination silently
 * fails OPEN in a test — an admin-only path looks correctly refused — so it
 * needs its own helper rather than a note somewhere.
 */
export async function actAsAdmin(tx: Tx, userId: string): Promise<void> {
  await tx.query(
    `select set_config('request.jwt.claims',
       json_build_object('sub', $1::text, 'user_role', 'admin')::text, true)`,
    [userId],
  )
}

/** One redemption row, whole. */
export async function redemption(tx: Tx, id: string) {
  const { rows } = await tx.query(`select * from public.redemptions where id = $1`, [id])
  return rows[0]
}

/**
 * Asserts a call fails, and returns the message so the test can say WHICH
 * failure it wanted.
 *
 * "It threw" is a weak assertion on a money path: a typo in a function name
 * also throws, and would make a test that is checking a kill switch pass
 * while the kill switch does nothing.
 *
 * THE SAVEPOINT IS NOT OPTIONAL. Postgres poisons a transaction the moment a
 * statement inside it raises: every later command returns "current
 * transaction is aborted" until somebody rolls back. Almost every test here
 * asserts a refusal and THEN checks the balance survived it, so without a
 * savepoint to rewind to, the check that matters most — that nothing moved —
 * cannot run at all. Catching the error is not enough; the transaction has
 * to be put back to where it was.
 */
export async function expectRejection(
  tx: Tx,
  body: () => Promise<unknown>,
): Promise<string> {
  await tx.query('savepoint expect_rejection')

  try {
    await body()
  } catch (error) {
    await tx.query('rollback to savepoint expect_rejection')
    return error instanceof Error ? error.message : String(error)
  }

  await tx.query('release savepoint expect_rejection')
  throw new Error('Expected this to be refused, but it succeeded.')
}
