import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, setConfig, withRollback } from '../support/db'

/**
 * SMS codes: `otp_issue` and `otp_check` (migration 20260902000000).
 *
 * Every SMS costs money and every code guards an account, so the limits live
 * in the database under a lock rather than in the app. These tests call the
 * functions the way the server does, with an already-hashed code: the hash is
 * the app's business, and a match here is plain string equality.
 */

type Issued = { ok: boolean; reason?: string; id?: string }
type Checked = { ok: boolean; reason?: string; attempts_left?: number }

const PHONE = '0240000001'

const issue = async (tx: Tx, hash: string, opts: { purpose?: string; phone?: string; user?: string | null } = {}) => {
  const { rows } = await tx.query<{ r: Issued }>(
    `select public.otp_issue($1, $2, $3, $4, null) as r`,
    [opts.purpose ?? 'signup', opts.phone ?? PHONE, opts.user ?? null, hash],
  )
  return rows[0]!.r
}

const check = async (tx: Tx, hash: string, opts: { purpose?: string; phone?: string; user?: string | null } = {}) => {
  const { rows } = await tx.query<{ r: Checked }>(
    `select public.otp_check($1, $2, $3, $4) as r`,
    [opts.purpose ?? 'signup', opts.phone ?? PHONE, opts.user ?? null, hash],
  )
  return rows[0]!.r
}

/** Lets a test issue again without waiting out the resend cooldown. */
const ageCodes = (tx: Tx, seconds: number) =>
  tx.query(`update public.phone_otps set created_at = created_at - make_interval(secs => $1)`, [seconds])

/** Moves every code AND the lockout clock back, as if time had passed. */
const ageAll = async (tx: Tx, seconds: number) => {
  await ageCodes(tx, seconds)
  await tx.query(
    `update public.otp_lockouts
        set window_start   = window_start - make_interval(secs => $1),
            locked_until   = locked_until - make_interval(secs => $1),
            last_strike_at = last_strike_at - make_interval(secs => $1)`,
    [seconds],
  )
}

describe.skipIf(!HAS_DB)('issuing a code', () => {
  it('issues, then refuses a second within the cooldown', () =>
    withRollback(async (tx) => {
      expect((await issue(tx, 'a')).ok).toBe(true)
      const again = await issue(tx, 'b')
      expect(again).toMatchObject({ ok: false, reason: 'cooldown' })
    }))

  it('locks a number for 5 minutes once its 3rd code goes out, across every purpose', () =>
    withRollback(async (tx) => {
      for (const purpose of ['signup', 'verify_phone', 'reset_password']) {
        expect((await issue(tx, 'x', { purpose })).ok).toBe(true)
      }
      const refused = (await issue(tx, 'x', { purpose: 'change_phone' })) as Issued & { retry_after?: string }
      expect(refused).toMatchObject({ ok: false, reason: 'limit' })
      const wait = (new Date(refused.retry_after!).getTime() - Date.now()) / 60000
      expect(wait).toBeGreaterThan(4)
      expect(wait).toBeLessThanOrEqual(5.1)
    }))

  it('grows each lockout after the first: 1h, then 2h, capped by config', () =>
    withRollback(async (tx) => {
      const lockLengthHours = async () => {
        for (let i = 0; i < 3; i++) {
          expect((await issue(tx, 'x')).ok).toBe(true)
          await ageAll(tx, 120)
        }
        const { rows } = await tx.query<{ h: number }>(
          `select extract(epoch from locked_until - last_strike_at) / 3600 as h from public.otp_lockouts where phone = $1`,
          [PHONE],
        )
        // Wait the lockout out.
        await ageAll(tx, Math.ceil(Number(rows[0]!.h) * 3600) + 1)
        return Math.round(Number(rows[0]!.h) * 60) / 60
      }
      expect(await lockLengthHours()).toBeCloseTo(5 / 60)
      expect(await lockLengthHours()).toBe(1)
      expect(await lockLengthHours()).toBe(2)
      await setConfig(tx, 'otp_lock_max_hours', '3')
      expect(await lockLengthHours()).toBe(3)
    }))

  it('clears the count when a code is entered correctly', () =>
    withRollback(async (tx) => {
      await issue(tx, 'a')
      await ageAll(tx, 120)
      await issue(tx, 'b')
      expect(await check(tx, 'b')).toMatchObject({ ok: true })
      await ageAll(tx, 120)
      // Two more would have been the 3rd and 4th; after a proof they are the 1st and 2nd.
      expect((await issue(tx, 'c', { purpose: 'reset_password' })).ok).toBe(true)
      await ageAll(tx, 120)
      expect((await issue(tx, 'd', { purpose: 'change_password' })).ok).toBe(true)
      await ageAll(tx, 120)
      expect((await issue(tx, 'e', { purpose: 'change_phone' })).ok).toBe(true)
    }))

  it('retires the previous code when a new one is sent', () =>
    withRollback(async (tx) => {
      await issue(tx, 'first')
      await ageCodes(tx, 120)
      await issue(tx, 'second')
      expect(await check(tx, 'first')).toMatchObject({ ok: false })
      expect(await check(tx, 'second')).toMatchObject({ ok: true })
    }))
})

describe.skipIf(!HAS_DB)('checking a code', () => {
  it('accepts the right code exactly once', () =>
    withRollback(async (tx) => {
      await issue(tx, 'good')
      expect((await check(tx, 'good')).ok).toBe(true)
      expect(await check(tx, 'good')).toMatchObject({ ok: false, reason: 'expired' })
    }))

  it('counts wrong tries down and retires the code on the fifth', () =>
    withRollback(async (tx) => {
      await issue(tx, 'good')
      for (let left = 4; left >= 1; left--) {
        expect(await check(tx, 'bad')).toMatchObject({ ok: false, reason: 'wrong', attempts_left: left })
      }
      expect(await check(tx, 'bad')).toMatchObject({ ok: false, reason: 'locked' })
      // Even the right code is dead now.
      expect((await check(tx, 'good')).ok).toBe(false)
    }))

  it('refuses an expired code', () =>
    withRollback(async (tx) => {
      await issue(tx, 'good')
      await tx.query(`update public.phone_otps set expires_at = now() - interval '1 second'`)
      expect(await check(tx, 'good')).toMatchObject({ ok: false, reason: 'expired' })
    }))

  it('never lets a code answer for another purpose, number or account', () =>
    withRollback(async (tx) => {
      const owner = await createUser(tx)
      const other = await createUser(tx)
      await issue(tx, 'good', { purpose: 'reset_password', user: owner.id })

      expect((await check(tx, 'good', { purpose: 'signup' })).ok).toBe(false)
      expect((await check(tx, 'good', { purpose: 'reset_password', phone: '0240000002', user: owner.id })).ok).toBe(false)
      expect((await check(tx, 'good', { purpose: 'reset_password', user: other.id })).ok).toBe(false)
      expect((await check(tx, 'good', { purpose: 'reset_password', user: owner.id })).ok).toBe(true)
    }))
})

describe.skipIf(!HAS_DB)('the verified phone', () => {
  it('belongs to one account only', () =>
    withRollback(async (tx) => {
      const a = await createUser(tx)
      const b = await createUser(tx)
      await tx.query(`update public.profiles set phone = $2, phone_verified_at = now() where id = $1`, [a.id, PHONE])
      await expect(
        tx.query(`update public.profiles set phone = $2, phone_verified_at = now() where id = $1`, [b.id, PHONE]),
      ).rejects.toThrow(/profiles_verified_phone_key/)
    }))

  it('resolves to the account, in any spelling', () =>
    withRollback(async (tx) => {
      const a = await createUser(tx)
      await tx.query(`update public.profiles set phone = $2, phone_verified_at = now() where id = $1`, [a.id, PHONE])
      const { rows } = await tx.query(`select * from public.account_for_phone('+233 24 000 0001')`)
      expect(rows[0]).toMatchObject({ user_id: a.id, email: a.email })
    }))

  it('does not resolve an unverified number', () =>
    withRollback(async (tx) => {
      await createUser(tx, { phone: PHONE })
      const { rows } = await tx.query(`select * from public.account_for_phone($1)`, [PHONE])
      expect(rows).toHaveLength(0)
    }))

  it('is not something a member can write themselves', () =>
    withRollback(async (tx) => {
      const { rows } = await tx.query(
        `select has_column_privilege('authenticated', 'public.profiles', 'phone', 'UPDATE') as can`,
      )
      expect(rows[0]!.can).toBe(false)
    }))

  it('keeps every code function away from the public key', () =>
    withRollback(async (tx) => {
      const { rows } = await tx.query(
        `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authed
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('otp_issue','otp_check','account_for_phone','account_for_email','revoke_all_sessions')`,
      )
      expect(rows).toHaveLength(5)
      for (const r of rows) expect({ fn: r.proname, anon: r.anon, authed: r.authed }).toEqual({ fn: r.proname, anon: false, authed: false })
    }))
})
