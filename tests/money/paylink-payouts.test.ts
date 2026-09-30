import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  balanceOf,
  createAdmin,
  createUser,
  creditPoints,
  expectRejection,
  pinEconomy,
  setConfig,
  withRollback,
  type Tx,
} from '../support/db'

/**
 * Automatic crypto payouts through PayLink: the rules that decide whether a
 * withdrawal leaves without an admin, and what PayLink's answer does to it.
 *
 * Everything here is SQL (migration 20260910000000), so it needs the test
 * database with that migration applied. Without SUPABASE_DB_URL it is skipped,
 * as the rest of the money suite is.
 */

const WALLET = '0x1111111111111111111111111111111111111111'
const POINTS = 20_000

/** Every rule relaxed, so a test can tighten exactly the one it is about. */
async function relaxAllRules(tx: Tx) {
  await setConfig(tx, 'payouts_enabled', 'true')
  await setConfig(tx, 'payout_method_crypto_enabled', 'true')
  await setConfig(tx, 'auto_payout_enabled', 'true')
  await setConfig(tx, 'auto_payout_max_ghs', '0')
  await setConfig(tx, 'auto_payout_first_withdrawals_reviewed', '0')
  await setConfig(tx, 'auto_payout_max_withdrawals_per_window', '0')
  await setConfig(tx, 'auto_payout_user_daily_max_ghs', '0')
  await setConfig(tx, 'auto_payout_platform_daily_max_ghs', '0')
  await setConfig(tx, 'auto_payout_min_account_age_days', '0')
  await setConfig(tx, 'auto_payout_review_elevated_risk', 'false')
  await setConfig(tx, 'auto_payout_fraud_signal_days', '0')
  await setConfig(tx, 'auto_payout_review_shared_wallet', 'false')
  await setConfig(tx, 'auto_payout_review_new_wallet', 'false')
  await setConfig(tx, 'auto_payout_max_points_earned_24h', '0')
  await setConfig(tx, 'auto_payout_reversal_days', '0')
  await setConfig(tx, 'redemption_holding_hours', '0')
}

/** A member with a USDC-on-Base wallet on file and a withdrawal past its hold. */
async function baseWithdrawal(tx: Tx, options: { wallet?: string; points?: number } = {}) {
  const { wallet = WALLET, points = 10_000 } = options
  await tx.query(`update public.payout_coins set rail_confirmed = true, is_active = true where code = 'USDC'`)
  await tx.query(
    `update public.payout_coin_networks set rail_confirmed = true, is_active = true
      where code = 'BASE' and coin_id = (select id from public.payout_coins where code = 'USDC')`,
  )

  const user = await createUser(tx)
  await creditPoints(tx, user.id, POINTS)
  await tx.query(
    `select public.set_payout_details(
       $1, 'crypto',
       (select id from public.payout_coins where code = 'USDC'),
       (select n.id from public.payout_coin_networks n join public.payout_coins c on c.id = n.coin_id
         where c.code = 'USDC' and n.code = 'BASE'),
       $2)`,
    [user.id, wallet],
  )
  const { rows } = await tx.query<{ redemption_id: string }>(
    `select * from public.request_redemption($1, 'crypto', $2)`,
    [user.id, points],
  )
  const id = rows[0]!.redemption_id
  await tx.query(`update public.redemptions set holding_until = now() - interval '1 minute' where id = $1`, [id])
  await tx.query(`select public.release_matured_holds()`)
  return { user, id }
}

async function decide(tx: Tx, id: string): Promise<string> {
  const { rows } = await tx.query<{ d: string }>(`select public.auto_approve_redemption($1) as d`, [id])
  return rows[0]!.d
}

async function failedRules(tx: Tx, id: string): Promise<string[]> {
  const { rows } = await tx.query<{ rule: string }>(
    `select rule from public.redemption_rule_results where redemption_id = $1 and not passed order by rule`,
    [id],
  )
  return rows.map((r) => r.rule)
}

async function status(tx: Tx, id: string) {
  const { rows } = await tx.query<{ status: string; paylink_status: string | null; external_reference: string | null }>(
    `select status, paylink_status, external_reference from public.redemptions where id = $1`,
    [id],
  )
  return rows[0]!
}

describe.skipIf(!HAS_DB)('automatic payout rules', () => {
  it('approves a withdrawal when every rule passes', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx)
      await relaxAllRules(tx)
      const { id } = await baseWithdrawal(tx)
      expect(await decide(tx, id)).toBe('auto_approved')
      expect((await status(tx, id)).status).toBe('approved')
      expect(await failedRules(tx, id)).toEqual([])
    }))

  it('leaves everything for an admin while the master switch is off', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx)
      await relaxAllRules(tx)
      await setConfig(tx, 'auto_payout_enabled', 'false')
      const { id } = await baseWithdrawal(tx)
      expect(await decide(tx, id)).toBe('needs_review')
      expect((await status(tx, id)).status).toBe('pending_approval')
      expect(await failedRules(tx, id)).toEqual(['00_auto_payouts_on'])
    }))

  it('never approves while payouts are closed, even with every rule passing', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx)
      await relaxAllRules(tx)
      const { id } = await baseWithdrawal(tx)
      await setConfig(tx, 'payouts_enabled', 'false')
      expect(await decide(tx, id)).toBe('needs_review')
    }))

  it('sends a withdrawal above the amount limit to an admin', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx, { feePercent: 0, pointsPerCedi: 1000 })
      await relaxAllRules(tx)
      await setConfig(tx, 'auto_payout_max_ghs', '5')
      const { id } = await baseWithdrawal(tx, { points: 10_000 }) // GHS 10
      expect(await decide(tx, id)).toBe('needs_review')
      expect(await failedRules(tx, id)).toEqual(['01_max_amount'])
    }))

  it('reviews a member’s first withdrawals', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx)
      await relaxAllRules(tx)
      await setConfig(tx, 'auto_payout_first_withdrawals_reviewed', '1')
      const { id } = await baseWithdrawal(tx)
      expect(await decide(tx, id)).toBe('needs_review')
      expect(await failedRules(tx, id)).toEqual(['02_first_withdrawals'])
    }))

  it('reviews more withdrawals than allowed in the window', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx)
      await relaxAllRules(tx)
      await setConfig(tx, 'auto_payout_max_withdrawals_per_window', '1')
      const { user, id } = await baseWithdrawal(tx, { points: 5_000 })
      expect(await decide(tx, id)).toBe('auto_approved')

      const { rows } = await tx.query<{ redemption_id: string }>(
        `select * from public.request_redemption($1, 'crypto', 5000)`,
        [user.id],
      )
      const second = rows[0]!.redemption_id
      await tx.query(`update public.redemptions set holding_until = now() - interval '1 minute' where id = $1`, [second])
      await tx.query(`select public.release_matured_holds()`)
      expect(await decide(tx, second)).toBe('needs_review')
      expect(await failedRules(tx, second)).toEqual(['03_withdrawal_frequency'])
    }))

  it('reviews a wallet another account uses', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx)
      await relaxAllRules(tx)
      await setConfig(tx, 'auto_payout_review_shared_wallet', 'true')
      await baseWithdrawal(tx, { wallet: WALLET })
      const { id } = await baseWithdrawal(tx, { wallet: WALLET.toUpperCase().replace('0X', '0x') })
      expect(await decide(tx, id)).toBe('needs_review')
      expect(await failedRules(tx, id)).toEqual(['09_wallet_not_shared'])
    }))

  it('decides once: a withdrawal left for an admin stays with the admin', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx)
      await relaxAllRules(tx)
      await setConfig(tx, 'auto_payout_enabled', 'false')
      const { id } = await baseWithdrawal(tx)
      expect(await decide(tx, id)).toBe('needs_review')
      await setConfig(tx, 'auto_payout_enabled', 'true')
      expect(await decide(tx, id)).toBe('needs_review')
      expect((await status(tx, id)).status).toBe('pending_approval')
    }))
})

describe.skipIf(!HAS_DB)('what PayLink says about a payout', () => {
  async function approvedAndClaimed(tx: Tx) {
    await pinEconomy(tx)
    await relaxAllRules(tx)
    const w = await baseWithdrawal(tx)
    expect(await decide(tx, w.id)).toBe('auto_approved')
    const { rows } = await tx.query<{ id: string | null }>(`select (public.claim_paylink_payout($1)).id`, [w.id])
    expect(rows[0]!.id).toBe(w.id)
    return w
  }

  const apply = (tx: Tx, id: string, statusText: string, extra: { tx?: string; reason?: string } = {}) =>
    tx
      .query<{ r: string }>(
        `select public.apply_paylink_payout($1, 'po_1', $2, null, 1.234567, '12.15', $3, $4) as r`,
        [id, statusText, extra.tx ?? null, extra.reason ?? null],
      )
      .then((res) => res.rows[0]!.r)

  it('claims a payout once, so it cannot be sent twice at the same time', () =>
    withRollback(async (tx) => {
      const { id } = await approvedAndClaimed(tx)
      const { rows } = await tx.query<{ id: string | null }>(`select (public.claim_paylink_payout($1)).id`, [id])
      expect(rows[0]!.id).toBeNull()
    }))

  it('refuses to claim anything while payouts are closed', () =>
    withRollback(async (tx) => {
      await pinEconomy(tx)
      await relaxAllRules(tx)
      const { id } = await baseWithdrawal(tx)
      await decide(tx, id)
      await setConfig(tx, 'payouts_enabled', 'false')
      expect(await expectRejection(tx, () => tx.query(`select public.claim_paylink_payout($1)`, [id]))).toMatch(
        /Payouts are disabled/,
      )
    }))

  it('marks the withdrawal paid on completed, once', () =>
    withRollback(async (tx) => {
      const { id } = await approvedAndClaimed(tx)
      expect(await apply(tx, id, 'queued')).toBe('recorded')
      expect(await apply(tx, id, 'completed', { tx: '0xabc' })).toBe('paid')
      expect(await apply(tx, id, 'completed', { tx: '0xabc' })).toBe('already_done')
      expect(await status(tx, id)).toMatchObject({ status: 'paid', external_reference: '0xabc' })
    }))

  it('refunds the points once when PayLink fails or rejects it', () =>
    withRollback(async (tx) => {
      const { user, id } = await approvedAndClaimed(tx)
      const before = await balanceOf(tx, user.id)
      expect(await apply(tx, id, 'failed', { reason: 'wallet_unavailable' })).toBe('refunded')
      expect(await apply(tx, id, 'failed', { reason: 'wallet_unavailable' })).toBe('already_done')
      expect(await balanceOf(tx, user.id)).toBe(before + 10_000)
      expect((await status(tx, id)).status).toBe('failed')
    }))

  it('stops an admin declining or marking paid a payout PayLink is settling', () =>
    withRollback(async (tx) => {
      const { id } = await approvedAndClaimed(tx)
      const admin = await createAdmin(tx)
      expect(
        await expectRejection(tx, () =>
          tx.query(`select public.reject_redemption($1, $2, 'changed my mind')`, [admin.id, id]),
        ),
      ).toMatch(/sent through PayLink/)
      expect(
        await expectRejection(tx, () => tx.query(`select public.mark_redemption_paid($1, $2, 'ref')`, [admin.id, id])),
      ).toMatch(/sent through PayLink/)
    }))

  it('refuses a second payout id for the same withdrawal', () =>
    withRollback(async (tx) => {
      const { id } = await approvedAndClaimed(tx)
      expect(await apply(tx, id, 'queued')).toBe('recorded')
      const { rows } = await tx.query<{ r: string }>(
        `select public.apply_paylink_payout($1, 'po_other', 'completed') as r`,
        [id],
      )
      expect(rows[0]!.r).toBe('conflict')
      expect((await status(tx, id)).status).toBe('approved')
    }))
})
