import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  PINNED_LADDER,
  type Tx,
  balanceOf,
  creditPoints,
  createUser,
  pinEconomy,
  pinLadder,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * Manual mobile money, part paid from the balance (migration 20260907000000).
 *
 * The operator's rule, 2026-09-28: the points are taken when the buyer starts;
 * when the operator DECLINES they come back, when the operator ACCEPTS it is an
 * ordinary purchase. Both for plans and for the Vault. The admin's Confirm and
 * Reject buttons call confirm_*_payment and fail_*_payment, as these do.
 */

const PPC = 100 // points per cedi, pinned

const livePlans = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ n: string }>(
    `select count(*)::text as n from public.user_subscriptions
      where user_id = $1 and status in ('active', 'grace')`,
    [userId],
  )
  return Number(rows[0]!.n)
}

const aVaultPlan = async (tx: Tx, priceGhs: number) => {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.vault_plans (name, price_minor, currency_code, period_days, daily_return_percent)
     values ('Test Vault', $1::bigint, 'GHS', 30, 1) returning id`,
    [Math.round(priceGhs * 100)],
  )
  return rows[0]!.id
}

describe.skipIf(!HAS_DB)('a plan part paid from the balance, the rest sent by hand', () => {
  const setup = async (tx: Tx, balanceGhs: number) => {
    await pinEconomy(tx, { pointsPerCedi: PPC })
    await pinLadder(tx)
    await setConfig(tx, 'plan_balance_purchase_enabled', 'true')
    const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!
    const buyer = await createUser(tx, { name: 'Split Buyer' })
    await creditPoints(tx, buyer.id, balanceGhs * PPC)
    const { rows: tier } = await tx.query<{ id: string }>(`select id from public.tiers where slug = 'bronze'`)
    const { rows } = await tx.query<{ id: string; method: string; amount_minor: string; balance_minor: string }>(
      `select * from public.start_manual_plan_topup($1, $2, $3::bigint)`,
      [buyer.id, tier[0]!.id, Math.round(bronze.priceGhs * 100)],
    )
    return { buyer, bronze, pay: rows[0]! }
  }

  it('takes the points at the start and leaves only the rest to send', () =>
    withRollback(async (tx) => {
      const { buyer, bronze, pay } = await setup(tx, 20)
      expect(pay.method).toBe('manual')
      expect(Number(pay.balance_minor)).toBe(2000)
      expect(Number(pay.amount_minor)).toBe(Math.round(bronze.priceGhs * 100) - 2000)
      expect(await balanceOf(tx, buyer.id)).toBe(0)
    }))

  it('DECLINED: the points come back and no plan is given', () =>
    withRollback(async (tx) => {
      const { buyer, pay } = await setup(tx, 20)
      await tx.query(`select * from public.fail_subscription_payment($1, $2)`, [pay.id, 'Declined'])
      expect(await balanceOf(tx, buyer.id)).toBe(20 * PPC)
      expect(await livePlans(tx, buyer.id)).toBe(0)
    }))

  it('ACCEPTED: the plan is given and the points stay spent', () =>
    withRollback(async (tx) => {
      const { buyer, pay } = await setup(tx, 20)
      await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [pay.id, 'P-TEST'])
      expect(await livePlans(tx, buyer.id)).toBe(1)
      expect(await balanceOf(tx, buyer.id)).toBe(0)
    }))

  it('refuses when the balance already covers the whole price', () =>
    withRollback(async (tx) => {
      await expect(setup(tx, 10_000)).rejects.toThrow(/covers this plan in full/i)
    }))
})

describe.skipIf(!HAS_DB)('a Vault deposit sent by hand', () => {
  const start = async (tx: Tx, balanceGhs: number, useBalance: boolean) => {
    await pinEconomy(tx, { pointsPerCedi: PPC })
    await setConfig(tx, 'vault_enabled', 'true')
    const planId = await aVaultPlan(tx, 200)
    const buyer = await createUser(tx, { name: 'Vault Buyer' })
    if (balanceGhs) await creditPoints(tx, buyer.id, balanceGhs * PPC)
    const { rows } = await tx.query<{
      id: string
      method: string
      amount_minor: string
      balance_minor: string | null
    }>(`select * from public.start_manual_vault_payment($1, $2, $3)`, [buyer.id, planId, useBalance])
    return { buyer, pay: rows[0]! }
  }

  const deposits = async (tx: Tx, paymentId: string) => {
    const { rows } = await tx.query<{ amount_minor: string }>(
      `select amount_minor from public.vault_investments where payment_id = $1`,
      [paymentId],
    )
    return rows
  }

  it('without the balance: accepted starts a deposit of the full amount', () =>
    withRollback(async (tx) => {
      const { pay } = await start(tx, 0, false)
      expect(pay.method).toBe('manual')
      expect(pay.balance_minor).toBeNull()
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [pay.id, 'P-TEST'])
      const made = await deposits(tx, pay.id)
      expect(made).toHaveLength(1)
      expect(Number(made[0]!.amount_minor)).toBe(20000)
    }))

  it('part from the balance: points taken at the start, the deposit is still the FULL amount', () =>
    withRollback(async (tx) => {
      const { buyer, pay } = await start(tx, 50, true)
      expect(Number(pay.balance_minor)).toBe(5000)
      expect(Number(pay.amount_minor)).toBe(20000)
      expect(await balanceOf(tx, buyer.id)).toBe(0)
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [pay.id, 'P-TEST'])
      const made = await deposits(tx, pay.id)
      expect(Number(made[0]!.amount_minor)).toBe(20000)
      expect(await balanceOf(tx, buyer.id)).toBe(0)
    }))

  it('part from the balance, DECLINED: the points come back and no deposit is made', () =>
    withRollback(async (tx) => {
      const { buyer, pay } = await start(tx, 50, true)
      await tx.query(`select * from public.fail_vault_payment($1, $2)`, [pay.id, 'Declined'])
      expect(await balanceOf(tx, buyer.id)).toBe(50 * PPC)
      expect(await deposits(tx, pay.id)).toHaveLength(0)
    }))

  it('declined, then accepted after all: the points are taken again and the deposit starts', () =>
    withRollback(async (tx) => {
      const { buyer, pay } = await start(tx, 50, true)
      await tx.query(`select * from public.fail_vault_payment($1, $2)`, [pay.id, 'Declined'])
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [pay.id, 'P-TEST'])
      expect(await balanceOf(tx, buyer.id)).toBe(0)
      expect(await deposits(tx, pay.id)).toHaveLength(1)
    }))
})
