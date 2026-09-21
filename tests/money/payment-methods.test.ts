import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  balanceOf,
  createAdmin,
  createUser,
  creditPoints,
  expectRejection,
  givePayoutDetails,
  pinEconomy,
  setConfig,
  withRollback,
  type Tx,
} from '../support/db'

/**
 * Switching a payout method off has to close it in the DATABASE.
 *
 * The operator's request was for an admin toggle, and the easy version of
 * that is a hidden card on the payout screen. This repository already has a
 * memo about what that is worth: three faults sat behind
 * `affiliate_payouts_enabled=false` for weeks because nothing exercised the
 * code the switch was hiding, and a switch that only hides a button is a
 * switch that does nothing to anybody who reaches the function another way.
 *
 * So both writes are tested, because both are reachable:
 *
 *   set_payout_details   saving a destination on a closed rail
 *   request_redemption   spending a destination that was saved while it was
 *                        open and is closed now
 *
 * The second is the one that is easy to miss. A wallet saved in June does not
 * un-save itself when crypto is switched off in September, and without the
 * guard the withdrawal would have gone through on a rail nobody is paying.
 *
 * ⚠️ THESE TESTS TURN MOBILE MONEY OFF. Everything is inside a transaction
 * that is rolled back, so the shared project never sees it, but a test that
 * left `payout_method_mobile_money_enabled` false would close withdrawals for
 * everybody. Nothing here commits; see tests/support/db.ts.
 */

const POINTS = 40_000
const REQUEST = 12_000

const requestRedemption = (tx: Tx, userId: string, method: 'mobile_money' | 'crypto') =>
  tx.query(`select * from public.request_redemption($1, $2::public.payout_method, $3)`, [
    userId,
    method,
    REQUEST,
  ])

const saveMomo = (tx: Tx, userId: string) =>
  tx.query(
    `select public.set_payout_details(
       $1, 'mobile_money', null, null, null,
       (select id from public.payout_providers where code = 'MTN_MOMO'),
       '0244000222', 'Test User')`,
    [userId],
  )

describe.skipIf(!HAS_DB)('a payout method that has been switched off', () => {
  it('ships with crypto closed and mobile money open', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query<{ key: string; value: string }>(
        `select key, value from public.app_config
          where key in ('payout_method_mobile_money_enabled', 'payout_method_crypto_enabled')
          order by key`,
      )

      /* The defaults the operator asked for on 2026-09-21: crypto is not
         accepted yet. Asserted rather than assumed, because a switch that
         ships ON is a switch nobody remembers to turn off. */
      expect(rows).toEqual([
        { key: 'payout_method_crypto_enabled', value: 'false' },
        { key: 'payout_method_mobile_money_enabled', value: 'true' },
      ])
    })
  })

  it('refuses a new destination on it', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await tx.query(
        `update public.payout_providers set rail_confirmed = true, is_active = true
          where code = 'MTN_MOMO'`,
      )

      await setConfig(tx, 'payout_method_mobile_money_enabled', 'false')

      const message = await expectRejection(tx, () => saveMomo(tx, user.id))
      expect(message).toMatch(/not available/i)

      // And says so before it has looked at anything the user typed: the
      // guard is about the rail, not about the number.
      const { rows } = await tx.query(
        `select 1 from public.user_payout_details where user_id = $1`,
        [user.id],
      )
      expect(rows).toHaveLength(0)
    })
  })

  it('refuses a withdrawal to a destination saved while it was open', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: 1000, feePercent: 0 })
      const user = await createUser(tx)

      // Saved while the rail is open, which is the realistic history.
      await givePayoutDetails(tx, user.id)
      await creditPoints(tx, user.id, POINTS)

      await setConfig(tx, 'payout_method_mobile_money_enabled', 'false')

      const message = await expectRejection(tx, () =>
        requestRedemption(tx, user.id, 'mobile_money'),
      )
      expect(message).toMatch(/not available/i)

      // The points never left. A refusal that had debited first would be the
      // worst of both.
      expect(await balanceOf(tx, user.id)).toBe(POINTS)
    })
  })

  it('lets the same withdrawal through once it is switched back on', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: 1000, feePercent: 0 })
      const user = await createUser(tx)
      await givePayoutDetails(tx, user.id)
      await creditPoints(tx, user.id, POINTS)

      await setConfig(tx, 'payout_method_mobile_money_enabled', 'false')
      await expectRejection(tx, () => requestRedemption(tx, user.id, 'mobile_money'))

      await setConfig(tx, 'payout_method_mobile_money_enabled', 'true')
      await requestRedemption(tx, user.id, 'mobile_money')

      expect(await balanceOf(tx, user.id)).toBe(POINTS - REQUEST)
    })
  })

  it('does not touch payouts already in the queue', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: 1000, feePercent: 0 })
      const user = await createUser(tx)
      await givePayoutDetails(tx, user.id)
      await creditPoints(tx, user.id, POINTS)

      await requestRedemption(tx, user.id, 'mobile_money')
      await setConfig(tx, 'payout_method_mobile_money_enabled', 'false')

      /* Somebody is owed this money on this rail. Closing the method must not
         make an existing request disappear from the admin queue, or the
         operator cannot pay a debt they have already taken the points for. */
      const { rows } = await tx.query<{ status: string; method: string }>(
        `select status::text, method::text from public.redemptions where user_id = $1`,
        [user.id],
      )
      expect(rows).toEqual([{ status: 'held', method: 'mobile_money' }])
    })
  })
})

describe.skipIf(!HAS_DB)('the switch itself', () => {
  it('is one function, so both writers ask the same question', async () => {
    await withRollback(async (tx) => {
      /* The point of `payout_method_enabled` is that it is the ONLY place the
         question is answered. If a future change re-implements it inline in
         one of the two callers, the two will drift, which is exactly how the
         feed and the watch came to disagree about repeats (migration 222). */
      const { rows } = await tx.query<{ name: string; body: string }>(
        `select p.proname as name, pg_get_functiondef(p.oid) as body
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('set_payout_details', 'request_redemption')`,
      )

      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row.body, row.name).toContain('payout_method_enabled')
      }
    })
  })

  it('is admin-configurable through the settings screen', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      const { rows } = await tx.query<{ config_key: string; new_value: string }>(
        `select * from public.admin_set_config($1, $2::jsonb)`,
        [admin.id, JSON.stringify({ payout_method_crypto_enabled: 'true' })],
      )

      expect(rows).toEqual([
        expect.objectContaining({ config_key: 'payout_method_crypto_enabled', new_value: 'true' }),
      ])
    })
  })
})
