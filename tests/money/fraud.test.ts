import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { HAS_DB, createUser, withRollback, type Tx } from '../support/db'

/**
 * The device layer of the fraud checks.
 *
 * WHY THESE ARE IN THE MONEY SUITE. On a watch-to-earn platform the fraud that
 * costs money is one person running many accounts: every extra account is
 * another daily allowance of points, and points now leave as cash. Three of the
 * enabled checks are about a DEVICE rather than an account, and all three were
 * inert until the browser started sending a fingerprint — `evaluate_signup_fraud`
 * and `apply_referral_code` have taken `p_fingerprint` since the fraud layer was
 * built and the application passed `undefined` to both.
 *
 * So the tests that matter here are not only "the check fires". They are:
 *   · it fires at the configured number of accounts, not one either side;
 *   · it goes silent again the moment the fingerprint stops being passed —
 *     which is exactly the state this whole layer was in, and the state a
 *     careless refactor would put it back into;
 *   · it FLAGS and never BLOCKS, because a device check that locks a real
 *     person out of registering costs more than the accounts it stops.
 */

/**
 * A device, in the shape the browser really produces: ThumbmarkJS returns a
 * 32-character hex hash.
 *
 * FRESH PER TEST, and that is not tidiness. These run against the shared dev
 * database inside a transaction that can still SEE every committed row, so a
 * hard-coded hash counts the real accounts already on that device — the first
 * version of this file used the two hashes captured from a real browser and
 * three tests failed because the demo admin was sitting on both of them.
 */
function newDevice(): string {
  return randomBytes(16).toString('hex')
}

let deviceA = newDevice()
let deviceB = newDevice()

beforeEach(() => {
  deviceA = newDevice()
  deviceB = newDevice()
})

/** A sign-in from a device, recorded the way the auth actions record one. */
async function seenOnDevice(tx: Tx, userId: string, fingerprint: string | null) {
  await tx.query(
    `select public.record_auth_signal($1, 'login', null, $2, 'test-agent', 'GH')`,
    [userId, fingerprint],
  )
}

type Decision = {
  allowed: boolean
  block_reason: string | null
  score: number
  level: string
  signals_fired: string[]
}

/**
 * The signup evaluation, called as the signup action calls it.
 *
 * `select * from f(...)` rather than `select (f(...)).*` — the second form
 * calls the function once per output column, which on a function that WRITES
 * fraud signals would record every one of them five times over.
 */
async function evaluateSignup(
  tx: Tx,
  userId: string,
  options: { email?: string; phone?: string; fingerprint?: string | null } = {},
): Promise<Decision> {
  const { email = `fixture-${userId.slice(0, 8)}@test.invalid`, phone = null, fingerprint = null } = options

  const { rows } = await tx.query<Decision>(
    `select * from public.evaluate_signup_fraud($1, $2, $3, null, $4)`,
    [userId, email, phone, fingerprint],
  )
  return rows[0]!
}

async function signalsFor(tx: Tx, userId: string): Promise<string[]> {
  const { rows } = await tx.query<{ check_code: string }>(
    `select check_code from public.fraud_signals where user_id = $1 order by check_code`,
    [userId],
  )
  return rows.map((r) => r.check_code)
}

/** The device rows a user has accumulated. */
async function devicesOf(tx: Tx, userId: string) {
  const { rows } = await tx.query<{ fingerprint: string; seen_count: number }>(
    `select fingerprint, seen_count from public.user_devices
      where user_id = $1 order by first_seen_at`,
    [userId],
  )
  return rows
}

describe.skipIf(!HAS_DB)('recording a device', () => {
  it('stores the fingerprint against the sign-in and against the account', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await seenOnDevice(tx, user.id, deviceA)

      const { rows } = await tx.query<{ fingerprint: string }>(
        `select fingerprint from public.auth_signals where user_id = $1`,
        [user.id],
      )
      expect(rows[0]!.fingerprint).toBe(deviceA)
      expect(await devicesOf(tx, user.id)).toEqual([{ fingerprint: deviceA, seen_count: 1 }])
    })
  })

  it('counts a device again rather than duplicating it', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await seenOnDevice(tx, user.id, deviceA)
      await seenOnDevice(tx, user.id, deviceA)
      await seenOnDevice(tx, user.id, deviceB)

      // Two devices, and the one used twice says so. Without the seen_count
      // upsert a returning user would look like a new device every visit and
      // the multi-account count would be meaningless.
      expect(await devicesOf(tx, user.id)).toEqual([
        { fingerprint: deviceA, seen_count: 2 },
        { fingerprint: deviceB, seen_count: 1 },
      ])
    })
  })

  it('records the sign-in but no device when the browser sent no fingerprint', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await seenOnDevice(tx, user.id, null)

      // A privacy browser, a blocked API or a slow phone that timed out. The
      // signal is still worth having for its IP and user agent; there is
      // simply no device to attribute it to.
      const { rows } = await tx.query(`select 1 from public.auth_signals where user_id = $1`, [user.id])
      expect(rows).toHaveLength(1)
      expect(await devicesOf(tx, user.id)).toEqual([])
    })
  })
})

describe.skipIf(!HAS_DB)('one device behind several accounts', () => {
  /** Puts `count` other accounts on a device, then signs the subject up on it. */
  async function crowdedDevice(tx: Tx, others: number) {
    for (let i = 0; i < others; i += 1) {
      const other = await createUser(tx, { name: `Other ${i}` })
      await seenOnDevice(tx, other.id, deviceA)
    }

    const subject = await createUser(tx, { name: 'Subject' })
    // The signup action records the auth signal BEFORE it evaluates, so the
    // new account is already on the device by the time the check counts.
    await seenOnDevice(tx, subject.id, deviceA)
    return subject
  }

  it('fires once the device carries as many other accounts as the setting allows', async () => {
    await withRollback(async (tx) => {
      // fraud_fingerprint_max_accounts is 2, so the third account on a device
      // is the one that trips it.
      const subject = await crowdedDevice(tx, 2)
      const decision = await evaluateSignup(tx, subject.id, { fingerprint: deviceA })

      expect(decision.signals_fired).toContain('device_multi_account')
      expect(await signalsFor(tx, subject.id)).toContain('device_multi_account')

      const { rows } = await tx.query<{ details: { other_accounts: number } }>(
        `select details from public.fraud_signals
          where user_id = $1 and check_code = 'device_multi_account'`,
        [subject.id],
      )
      expect(rows[0]!.details.other_accounts).toBe(2)
    })
  })

  it('says nothing about the second account on a device', async () => {
    await withRollback(async (tx) => {
      // A household sharing a phone is ordinary, and a platform aimed at
      // Ghana cannot treat it as fraud on sight.
      const subject = await crowdedDevice(tx, 1)
      const decision = await evaluateSignup(tx, subject.id, { fingerprint: deviceA })

      expect(decision.signals_fired).not.toContain('device_multi_account')
      expect(await signalsFor(tx, subject.id)).not.toContain('device_multi_account')
    })
  })

  it('follows the configured limit rather than a hard-coded number', async () => {
    await withRollback(async (tx) => {
      await tx.query(
        `update public.app_config set value = '4' where key = 'fraud_fingerprint_max_accounts'`,
      )

      const subject = await crowdedDevice(tx, 3)
      const decision = await evaluateSignup(tx, subject.id, { fingerprint: deviceA })
      expect(decision.signals_fired).not.toContain('device_multi_account')
    })
  })

  it('is blind to a crowded device when no fingerprint is passed', async () => {
    await withRollback(async (tx) => {
      const subject = await crowdedDevice(tx, 5)

      // THE REGRESSION THIS FILE EXISTS FOR. This call is the one the
      // application made for months: everything else identical, fingerprint
      // undefined. Five accounts on one device and the check cannot see any
      // of them.
      const decision = await evaluateSignup(tx, subject.id, { fingerprint: null })

      expect(decision.signals_fired).not.toContain('device_multi_account')
      expect(await signalsFor(tx, subject.id)).not.toContain('device_multi_account')
    })
  })

  it('flags the account without refusing the signup', async () => {
    await withRollback(async (tx) => {
      const subject = await crowdedDevice(tx, 2)
      const decision = await evaluateSignup(tx, subject.id, { fingerprint: deviceA })

      // `device_multi_account` is a flag, not a block. Someone whose signup
      // was refused has no account to appeal from, and the honest handling of
      // a suspicion is a review — which is what the score and the queue are
      // for.
      expect(decision.allowed).toBe(true)
      expect(decision.block_reason).toBeNull()
      expect(decision.score).toBeGreaterThanOrEqual(30)
    })
  })

  it('does not count accounts from a different device', async () => {
    await withRollback(async (tx) => {
      for (let i = 0; i < 3; i += 1) {
        const other = await createUser(tx)
        await seenOnDevice(tx, other.id, deviceB)
      }

      const subject = await createUser(tx)
      await seenOnDevice(tx, subject.id, deviceA)
      const decision = await evaluateSignup(tx, subject.id, { fingerprint: deviceA })

      expect(decision.signals_fired).not.toContain('device_multi_account')
    })
  })
})

describe.skipIf(!HAS_DB)('referring yourself', () => {
  async function referralCodeOf(tx: Tx, userId: string): Promise<string> {
    const { rows } = await tx.query<{ referral_code: string }>(
      `select referral_code from public.profiles where id = $1`,
      [userId],
    )
    return rows[0]!.referral_code
  }

  it('is suspected when referrer and referee share a device', async () => {
    await withRollback(async (tx) => {
      const referrer = await createUser(tx, { name: 'Referrer' })
      await seenOnDevice(tx, referrer.id, deviceA)

      const referee = await createUser(tx, { name: 'Referee' })
      await seenOnDevice(tx, referee.id, deviceA)

      await tx.query(`select * from public.apply_referral_code($1, $2, null, $3)`, [
        referee.id,
        await referralCodeOf(tx, referrer.id),
        deviceA,
      ])

      // BOTH sides are flagged, deliberately: the account that collects the
      // bonus is the one worth reviewing, and it is not the new one.
      expect(await signalsFor(tx, referee.id)).toContain('self_referral_suspected')
      expect(await signalsFor(tx, referrer.id)).toContain('self_referral_suspected')
    })
  })

  it('still applies the referral — a suspicion is not a refusal', async () => {
    await withRollback(async (tx) => {
      const referrer = await createUser(tx, { name: 'Referrer' })
      await seenOnDevice(tx, referrer.id, deviceA)
      const referee = await createUser(tx, { name: 'Referee' })
      await seenOnDevice(tx, referee.id, deviceA)

      await tx.query(`select * from public.apply_referral_code($1, $2, null, $3)`, [
        referee.id,
        await referralCodeOf(tx, referrer.id),
        deviceA,
      ])

      const { rows } = await tx.query<{ referred_by: string }>(
        `select referred_by from public.profiles where id = $1`,
        [referee.id],
      )
      expect(rows[0]!.referred_by).toBe(referrer.id)
    })
  })

  it('says nothing when the two are on different devices', async () => {
    await withRollback(async (tx) => {
      const referrer = await createUser(tx, { name: 'Referrer' })
      await seenOnDevice(tx, referrer.id, deviceA)
      const referee = await createUser(tx, { name: 'Referee' })
      await seenOnDevice(tx, referee.id, deviceB)

      await tx.query(`select * from public.apply_referral_code($1, $2, null, $3)`, [
        referee.id,
        await referralCodeOf(tx, referrer.id),
        deviceB,
      ])

      expect(await signalsFor(tx, referee.id)).not.toContain('self_referral_suspected')
      expect(await signalsFor(tx, referrer.id)).not.toContain('self_referral_suspected')
    })
  })

  it('cannot see a shared device when no fingerprint is passed', async () => {
    await withRollback(async (tx) => {
      const referrer = await createUser(tx, { name: 'Referrer' })
      await seenOnDevice(tx, referrer.id, deviceA)
      const referee = await createUser(tx, { name: 'Referee' })
      await seenOnDevice(tx, referee.id, deviceA)

      // The other half of the regression: the same self-referral, with the
      // argument the application used to pass. No IP either, so there is
      // nothing left to notice it with.
      await tx.query(`select * from public.apply_referral_code($1, $2, null, null)`, [
        referee.id,
        await referralCodeOf(tx, referrer.id),
      ])

      expect(await signalsFor(tx, referee.id)).not.toContain('self_referral_suspected')
    })
  })
})
