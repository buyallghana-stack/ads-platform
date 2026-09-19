import { describe, expect, it } from 'vitest'

import { actAsAdmin, createAdmin, createUser, HAS_DB, type Tx, withRollback } from '../support/db'

/**
 * A vault deposit is money, and every money screen has to know it.
 *
 * Operator, 2026-09-19, after paying GHS 20 into the Vault with a real card:
 * *"a paid money for vault doesn't appear in total deposits and their traces
 * cannot also be found in payments."*
 *
 * Both were true. The Vault arrived after the money screens were written, and
 * `admin_overview_metrics`, `admin_finance_statement`, `admin_daily_money` and
 * `admin_list_hub_payments` all read `subscription_payments` and
 * `advertiser_payments` and stopped. A settled deposit was invisible in every
 * total and could be found on the payments screen only if something had gone
 * wrong with it and it surfaced as a flag.
 *
 * ⚠️ FOUR FUNCTIONS, ONE FACT. They are asserted together on purpose: the
 * headline, the chart under it, the monthly statement and the payments list
 * are four different readers of the same deposit, and the bug was that only
 * some of them had been taught. A test that checked one would have passed
 * while three screens still disagreed.
 */

const GHS = (minor: number) => minor / 100

/** A confirmed vault deposit, as the hub leaves one behind. */
async function vaultDeposit(
  tx: Tx,
  userId: string,
  amountMinor: number,
  options: { status?: string; reference?: string | null } = {},
) {
  const { status = 'confirmed', reference = `TS-TEST-${Math.random().toString(36).slice(2, 10)}` } =
    options

  const { rows: plan } = await tx.query<{ id: string }>(
    `insert into public.vault_plans (name, price_minor, period_days, daily_return_percent)
     values ('Test Vault', $1, 7, 1.5) returning id`,
    [amountMinor],
  )

  const { rows } = await tx.query<{ id: string }>(
    `insert into public.vault_payments
       (user_id, plan_id, amount_minor, status, external_reference, confirmed_at)
     values ($1, $2, $3, $4, $5, case when $4 = 'confirmed' then now() else null end)
     returning id`,
    [userId, plan[0]!.id, amountMinor, status, reference],
  )
  return rows[0]!.id
}

describe.skipIf(!HAS_DB)('a vault deposit reaches the money screens', () => {
  it('is counted in the deposits headline, and shown on its own line', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await actAsAdmin(tx, admin.id)
      const user = await createUser(tx)

      const before = await tx.query<{ metrics: Record<string, Record<string, string>> }>(
        `select public.admin_overview_metrics() as metrics`,
      )
      const wasTotal = Number(before.rows[0]!.metrics.deposits!.value)
      const wasVault = Number(before.rows[0]!.metrics.deposits!.vault ?? 0)

      await vaultDeposit(tx, user.id, 2000)

      const after = await tx.query<{ metrics: Record<string, Record<string, string>> }>(
        `select public.admin_overview_metrics() as metrics`,
      )
      const deposits = after.rows[0]!.metrics.deposits!

      expect(Number(deposits.vault)).toBe(wasVault + GHS(2000))
      expect(Number(deposits.value)).toBe(wasTotal + GHS(2000))

      /* Its own line, never folded into subscriptions. A deposit carries a
         contracted return and a plan purchase does not, and a headline that
         blended them would flatter the business. */
      expect(Number(deposits.subscriptions)).toBe(
        Number(before.rows[0]!.metrics.deposits!.subscriptions),
      )
    })
  })

  it('lands on the day it settled, in the chart under that headline', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await actAsAdmin(tx, admin.id)
      const user = await createUser(tx)

      const today = async () => {
        const { rows } = await tx.query<{ deposits: string }>(
          `select deposits::text from public.admin_daily_money(2)
            where day = current_date`,
        )
        return Number(rows[0]?.deposits ?? 0)
      }

      const was = await today()
      await vaultDeposit(tx, user.id, 5000)

      expect(await today()).toBe(was + GHS(5000))
    })
  })

  it('appears in the monthly statement as its own column', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await actAsAdmin(tx, admin.id)
      const user = await createUser(tx)

      const thisMonth = async () => {
        const { rows } = await tx.query<{ vault_ghs: string }>(
          `select vault_ghs::text from public.admin_finance_statement(1)
            where month = to_char(now(), 'YYYY-MM')`,
        )
        return Number(rows[0]?.vault_ghs ?? 0)
      }

      const was = await thisMonth()
      await vaultDeposit(tx, user.id, 12345)

      expect(await thisMonth()).toBe(was + GHS(12345))
    })
  })

  it('is traceable on the payments screen, and says it is a vault payment', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await actAsAdmin(tx, admin.id)
      const user = await createUser(tx, { name: 'Vault Buyer' })

      const reference = 'TS-VAULTTRACE01'
      const paymentId = await vaultDeposit(tx, user.id, 2000, { reference })

      const { rows } = await tx.query<{
        id: string
        payment_kind: string
        person: string
        item_name: string
        amount_minor: string
        status: string
        hub_reference: string
      }>(
        `select id, payment_kind, person, item_name, amount_minor::text, status, hub_reference
           from public.admin_list_hub_payments(500) where hub_reference = $1`,
        [reference],
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: paymentId,
        payment_kind: 'vault',
        person: 'Vault Buyer',
        item_name: 'Test Vault',
        amount_minor: '2000',
        status: 'confirmed',
      })
    })
  })

  it('still lists plan purchases beside it, with their own kind', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await actAsAdmin(tx, admin.id)

      /* The union must not have cost the original half of the screen. */
      const { rows } = await tx.query<{ kinds: string[] }>(
        `select array_agg(distinct payment_kind) as kinds
           from public.admin_list_hub_payments(500)`,
      )
      for (const kind of rows[0]?.kinds ?? []) {
        expect(['subscription', 'vault']).toContain(kind)
      }
    })
  })

  it('counts nothing until the money has actually arrived', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await actAsAdmin(tx, admin.id)
      const user = await createUser(tx)

      const vaultTotal = async () => {
        const { rows } = await tx.query<{ metrics: Record<string, Record<string, string>> }>(
          `select public.admin_overview_metrics() as metrics`,
        )
        return Number(rows[0]!.metrics.deposits!.vault ?? 0)
      }

      const was = await vaultTotal()
      await vaultDeposit(tx, user.id, 9900, { status: 'pending' })
      await vaultDeposit(tx, user.id, 8800, { status: 'failed' })

      /* A started checkout is not money. Only `confirmed` means it landed. */
      expect(await vaultTotal()).toBe(was)
    })
  })
})
