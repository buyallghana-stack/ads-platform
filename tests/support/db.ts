import { afterAll } from 'vitest'
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

/**
 * ⚠️ THE SUITE MAY NOT RUN AGAINST PRODUCTION.
 *
 * It did, for two months. The project it was written against was called "dev"
 * and was later renamed `sideperks-production`; the tests never moved. The
 * safeguards here are real, every test runs inside a transaction that rolls
 * back and files run one at a time, but a rollback only covers what goes
 * through that transaction, and the cost of the one thing that does not is
 * somebody's balance in an append-only ledger.
 *
 * A hard stop rather than a warning, because the failure mode is not
 * carelessness. It is convenience: the test database is slow or paused, the
 * old connection string is one line away, and nothing would object.
 *
 * `sideperks-test` is built from the same migrations, and its schema is
 * checked against production by scripts/diff-schema.cjs.
 */
const PRODUCTION_REF = 'mjivgeojeejaszcrkbbo'

if (CONNECTION && CONNECTION.includes(PRODUCTION_REF)) {
  throw new Error(
    'SUPABASE_DB_URL points at the PRODUCTION database. This suite writes to ' +
      'every money table it touches. Point it at sideperks-test: see tests/README.md.',
  )
}

export const HAS_DB = Boolean(CONNECTION)

/** What a test gets: a connected client already inside a transaction. */
export type Tx = Client

/**
 * ONE CONNECTION, REUSED, rather than one per test.
 *
 * WHY THIS CHANGED. Opening a connection to Supabase costs a TCP round trip
 * plus a TLS handshake plus authentication — measured at ~1.7 SECONDS from
 * here. At 430 tests that was about twelve minutes of every run spent
 * connecting, and worse than the time was the variance: two separate runs
 * failed with a different random pair of tests timing out at exactly the
 * limit, every one of them passing in isolation. The tests were not slow; the
 * connecting was.
 *
 * WHY IT IS SAFE, which is the part worth checking before copying this
 * pattern anywhere else:
 *
 *   The suite runs STRICTLY SERIALLY — `fileParallelism: false` and
 *   `sequence.concurrent: false` in vitest.config.ts. Two tests are never in
 *   flight at once, so they cannot interleave on one connection.
 *
 *   Nothing leaks between tests through session state. Everything a test
 *   changes is either a row (undone by the rollback) or transaction-local:
 *   `actAs`/`actAsAdmin` pass `true` to `set_config`, and the one place a role
 *   is switched uses `set local role`. Checked before this was written, and it
 *   is the thing to re-check if a test ever starts using a plain `set`.
 *
 * A POISONED SESSION IS DISCARDED, NOT REUSED. If the rollback itself fails —
 * a dropped link, a session left in an aborted state — the connection is
 * closed and the next test opens a fresh one. Without that, one bad test would
 * fail every test after it, which is a far worse failure than the flakiness
 * this replaces.
 */
let shared: Client | null = null

async function discard(): Promise<void> {
  const dying = shared
  shared = null
  if (!dying) return
  try {
    await dying.end()
  } catch {
    // Already gone. Nothing to do but stop referring to it.
  }
}

async function connection(): Promise<Client> {
  if (shared) return shared

  const client = new Client({
    connectionString: CONNECTION,
    // Supabase terminates TLS with its own chain. Verification is off because
    // the alternative is shipping their CA bundle into the repo for a test
    // harness; the connection is still encrypted.
    ssl: { rejectUnauthorized: false },
    statement_timeout: 15_000,
  })

  /* pg throws an unhandled 'error' event on an unexpected disconnect, which
     takes the whole worker down rather than failing one test. Catching it and
     dropping the reference means the next test simply reconnects. */
  client.on('error', () => {
    shared = null
  })

  await client.connect()
  shared = client
  return client
}

/* Closed when the file's tests finish, or the open handle keeps the worker
   alive and the run never exits. Wrapped because this module is imported by
   test files only — if it is ever pulled into a plain script there is no hook
   context to register against, and that should not be fatal. */
try {
  afterAll(async () => {
    await discard()
  })
} catch {
  // No test context. The connection closes when the process does.
}

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

  const client = await connection()

  try {
    await client.query('begin')
    return await body(client)
  } finally {
    try {
      await client.query('rollback')
    } catch {
      await discard()
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

  /* The backdating that used to live here is gone. Since migration 185 a
     first-time insert stamps `last_changed_at` at the epoch, because adding a
     destination is not changing one, so a fresh fixture is never inside the
     cool-off and there is nothing to undo. */
}

/**
 * Pins the parts of the ECONOMY a test depends on.
 *
 * These tests run against the shared project, where the operator changes plan
 * prices, daily caps and the value of a point whenever the business needs it
 * to change — and every one of those is an input to what a test asserts. A
 * test that inherits them passes until the day somebody moves a slider in the
 * admin, then fails with no code change behind it. It has happened twice: a
 * withdrawal fee set to 10% turned "GHS 12 of payout history" into GHS 10.80,
 * and the free plan dropping to one ad a day turned a second watch into
 * `daily_cap_reached`.
 *
 * So: anything asserting an amount, or watching more than one ad, says so here
 * first. Everything is inside the test's transaction and disappears with it.
 */
export async function pinEconomy(
  tx: Tx,
  options: {
    /** Ads a day allowed on the FREE plan — what a fixture user is on. */
    freeAdsPerDay?: number
    /** Points to one cedi. */
    pointsPerCedi?: number
    /** Withdrawal fee, as a percentage. */
    feePercent?: number
    /** Seconds a user must wait between ads. Zero unless a test is about it. */
    cooldownSeconds?: number
    /** Game plays a week on the FREE plan. Zero in production since the
     *  pricing restructure, which is not a useful default for testing games. */
    freeGamePlays?: number
  } = {},
): Promise<void> {
  const {
    freeAdsPerDay = 50,
    pointsPerCedi = 1000,
    feePercent = 0,
    cooldownSeconds = 0,
    freeGamePlays = 5,
  } = options

  await tx.query(
    `update public.tiers set daily_ad_cap = $1, weekly_game_plays = $2 where is_default`,
    [freeAdsPerDay, freeGamePlays],
  )
  await setConfig(tx, 'points_per_currency_unit', String(pointsPerCedi))
  await setConfig(tx, 'redemption_fee_percent', String(feePercent))
  await setConfig(tx, 'ad_cooldown_seconds_default', String(cooldownSeconds))
}

/**
 * One rung of a pinned ladder. Price in whole cedis, because that is how the
 * operator's pricing list is written and how a band is labelled.
 */
export type LadderRung = {
  slug: string
  name: string
  priceGhs: number
  multiplier: number
  dailyAdCap: number
  /** A ceiling of its own, for the TOP rung — the most somebody may pay for it
   *  and what they earn at if they do. Meaningless on any rung that has a plan
   *  above it, and pinned to null there so a production ceiling cannot leak
   *  into the fixture. */
  bandMaxGhs?: number
  bandMaxMultiplier?: number
}

/**
 * The ladder the band tests are written against.
 *
 * NOT a claim about what is on sale today. `pinEconomy` pins the free plan and
 * the value of a point; this pins the PAID rungs, which are just as much an
 * operator setting — on 2026-08-05 they moved Bronze from ×1.5 to ×1.39, Silver
 * from ×2.0 to ×1.84, Platinum from ×3.0 to ×4.12 and deleted Diamond outright,
 * and seven tests went red with no code change behind them.
 *
 * Interpolation, band boundaries and stacking are rules about the SHAPE of a
 * ladder, so they need a ladder that holds still. What is actually on sale is
 * checked separately, against the live tables, by the sweep in
 * `flexible-pricing.test.ts` — that one must read production or it guards
 * nothing.
 */
export const PINNED_LADDER: LadderRung[] = [
  { slug: 'free', name: 'Free', priceGhs: 0, multiplier: 1.0, dailyAdCap: 1 },
  { slug: 'bronze', name: 'Bronze', priceGhs: 65, multiplier: 1.5, dailyAdCap: 3 },
  { slug: 'silver', name: 'Silver', priceGhs: 140, multiplier: 2.0, dailyAdCap: 4 },
  { slug: 'gold', name: 'Gold', priceGhs: 250, multiplier: 2.5, dailyAdCap: 7 },
  { slug: 'platinum', name: 'Platinum', priceGhs: 520, multiplier: 3.0, dailyAdCap: 13 },
  { slug: 'diamond', name: 'Diamond', priceGhs: 1000, multiplier: 3.5, dailyAdCap: 15 },
]

/**
 * Puts the plan ladder into a known state for the length of the transaction.
 *
 * Every band function selects `where is_active` and orders by `sort_order`, so
 * pinning means three things and not one: upsert each rung (the operator may
 * have DELETED one — Diamond is gone from production), and switch off anything
 * else that would otherwise sit in the middle of the ladder and cut a band
 * somewhere unexpected.
 *
 * The peg goes with it. A rung's published points-per-ad is a product of its
 * multiplier AND `points_per_currency_unit`, so pinning one without the other
 * leaves the figures only half held down.
 */
export async function pinLadder(
  tx: Tx,
  options: { rungs?: LadderRung[]; pointsPerCedi?: number } = {},
): Promise<void> {
  const { rungs = PINNED_LADDER, pointsPerCedi = 100 } = options

  /* ONE ROUND TRIP, not one per rung. This runs in eleven tests in
     flexible-pricing alone, and each round trip is 200-300ms to a database in
     Paris — six inserts per call was ~15 seconds of pure latency across that
     file, which is what pushed its two heaviest tests past the 30s timeout the
     day the link slowed down. Unnesting the arrays makes it a single
     statement. */
  await tx.query(
    `insert into public.tiers
       (slug, name, description, price_minor, currency_code, billing_period_days,
        daily_ad_cap, reward_multiplier, redemption_minimum_points,
        referral_bonus_multiplier, ad_priority, ad_cooldown_seconds,
        weekly_game_plays, is_default, is_active, sort_order,
        band_max_minor, band_max_multiplier)
     select r.slug, r.name, r.name, r.price_minor, 'GHS', 30,
            r.daily_ad_cap, r.reward_multiplier, 5000,
            1.000, r.sort_order, 0,
            5, r.price_minor = 0, true, r.sort_order,
            r.band_max_minor, r.band_max_multiplier
       from unnest(
              $1::text[], $2::text[], $3::bigint[], $4::int[],
              $5::numeric[], $6::int[], $7::bigint[], $8::numeric[]
            ) as r(slug, name, price_minor, daily_ad_cap,
                   reward_multiplier, sort_order, band_max_minor, band_max_multiplier)
     on conflict (slug) do update set
       name = excluded.name,
       price_minor = excluded.price_minor,
       daily_ad_cap = excluded.daily_ad_cap,
       reward_multiplier = excluded.reward_multiplier,
       ad_priority = excluded.ad_priority,
       sort_order = excluded.sort_order,
       is_default = excluded.is_default,
       is_active = true,
       /* Written even when absent. Platinum carries a real ceiling in
          production, and inheriting it would silently give the fixture a top
          band no test asked for. */
       band_max_minor = excluded.band_max_minor,
       band_max_multiplier = excluded.band_max_multiplier`,
    [
      rungs.map((r) => r.slug),
      rungs.map((r) => r.name),
      rungs.map((r) => Math.round(r.priceGhs * 100)),
      rungs.map((r) => r.dailyAdCap),
      rungs.map((r) => r.multiplier),
      rungs.map((_, index) => index),
      rungs.map((r) => (r.bandMaxGhs === undefined ? null : Math.round(r.bandMaxGhs * 100))),
      rungs.map((r) => r.bandMaxMultiplier ?? null),
    ],
  )

  /* Anything the operator has added since. Left active it would cut a band
     against a price this file never mentions, and the failure would read as
     broken interpolation rather than an extra rung. */
  await tx.query(`update public.tiers set is_active = false where slug <> all($1::text[])`, [
    rungs.map((r) => r.slug),
  ])

  await setConfig(tx, 'points_per_currency_unit', String(pointsPerCedi))
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
