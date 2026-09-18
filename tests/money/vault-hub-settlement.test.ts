import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  balanceOf,
  createUser,
  expectRejection,
  pinEconomy,
  withRollback,
} from '../support/db'

/**
 * The SQL half of a Vault deposit settled by the payment hub.
 *
 * Until 18 September 2026 nothing but a browser redirect ever settled a
 * deposit, so three of the four functions here did not exist: a deposit could
 * not have a hub reference attached, could not be closed as failed, and could
 * not be reversed at all. `hub-vault-fulfilment.test.ts` covers the wiring that
 * chooses between them and mocks the database. This file is the other half, and
 * it runs against a real one, because what these functions protect is a
 * transaction boundary and a mock cannot have one.
 *
 * ⚠️ THE REVERSAL IS THE REASON THIS FILE EXISTS. A plan is a thing we stop
 * providing. A matured vault has already PAID POINTS OUT, and by the time a
 * refund arrives those points may be spent. The rule is the referral
 * clawback's: take what is there, never push a balance negative, and raise an
 * alert naming the shortfall. Getting that wrong turns a customer into a debtor
 * on a refund they may not have asked for.
 *
 * Every fixture is built inside the transaction. Vault plans are priced by the
 * operator in the admin, so a test that read a seeded one would fail the day
 * they retune it, which is the same rule `pinLadder` exists for.
 */

type Plan = { id: string; priceMinor: number }

const aVaultPlan = async (
  tx: Tx,
  options: { priceGhs?: number; periodDays?: number; dailyReturnPercent?: number } = {},
): Promise<Plan> => {
  const { priceGhs = 200, periodDays = 30, dailyReturnPercent = 1 } = options
  const { rows } = await tx.query<{ id: string; price_minor: string }>(
    `insert into public.vault_plans (name, price_minor, currency_code, period_days, daily_return_percent)
     values ($1, $2::bigint, 'GHS', $3::int, $4::numeric)
     returning id, price_minor`,
    [`Test Vault ${periodDays}d`, Math.round(priceGhs * 100), periodDays, dailyReturnPercent],
  )
  return { id: rows[0]!.id, priceMinor: Number(rows[0]!.price_minor) }
}

const startDeposit = async (tx: Tx, userId: string, planId: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `select * from public.start_vault_payment($1, $2)`,
    [userId, planId],
  )
  return rows[0]!.id
}

const payment = async (tx: Tx, id: string) => {
  const { rows } = await tx.query<{
    status: string
    external_reference: string | null
    failure_reason: string | null
    confirmed_at: string | null
  }>(
    `select status, external_reference, failure_reason, confirmed_at
       from public.vault_payments where id = $1`,
    [id],
  )
  return rows[0]!
}

const investments = async (tx: Tx, paymentId: string) => {
  const { rows } = await tx.query<{
    id: string
    status: string
    claimed_points: string | null
    expected_return_minor: string
  }>(
    `select id, status, claimed_points, expected_return_minor
       from public.vault_investments where payment_id = $1`,
    [paymentId],
  )
  return rows
}

const alerts = async (tx: Tx, code: string) => {
  const { rows } = await tx.query<{ code: string; context: Record<string, unknown> }>(
    `select code, context from public.system_alerts where code = $1`,
    [code],
  )
  return rows
}

/** Brings a confirmed investment to maturity, since a test cannot wait 30 days. */
const matureIt = (tx: Tx, investmentId: string) =>
  tx.query(`update public.vault_investments set ends_at = now() - interval '1 minute' where id = $1`, [
    investmentId,
  ])

describe.skipIf(!HAS_DB)('attaching the hub reference to a deposit', () => {
  it('stores it, so a paid deposit can be matched to a buyer', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx, { name: 'The Depositor' })
      const paymentId = await startDeposit(tx, buyer.id, plan.id)

      await tx.query(`select * from public.attach_vault_hub_reference($1, $2)`, [
        paymentId,
        'TS-VAULT-0001',
      ])

      expect((await payment(tx, paymentId)).external_reference).toBe('TS-VAULT-0001')
    })
  })

  it('accepts the same reference twice, because a reloaded checkout asks twice', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)

      await tx.query(`select * from public.attach_vault_hub_reference($1, $2)`, [paymentId, 'TS-SAME'])
      /* The hub answers a repeated request with the payment already running and
         the SAME reference. If this raised, reloading the page would be an
         error the buyer sees. */
      await tx.query(`select * from public.attach_vault_hub_reference($1, $2)`, [paymentId, 'TS-SAME'])

      expect((await payment(tx, paymentId)).external_reference).toBe('TS-SAME')
    })
  })

  it('refuses a second, different reference', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)

      await tx.query(`select * from public.attach_vault_hub_reference($1, $2)`, [paymentId, 'TS-FIRST'])

      /* Two references on one row means two payments at the provider and one
         place to record them, which is how a buyer pays twice and is credited
         once. */
      const message = await expectRejection(tx, () =>
        tx.query(`select * from public.attach_vault_hub_reference($1, $2)`, [paymentId, 'TS-SECOND']),
      )
      expect(message).toMatch(/already has a different reference/i)
      expect((await payment(tx, paymentId)).external_reference).toBe('TS-FIRST')
    })
  })

  it('refuses a payment that is no longer waiting for one', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)
      await tx.query(`select * from public.fail_vault_payment($1, $2)`, [paymentId, 'Gave up'])

      const message = await expectRejection(tx, () =>
        tx.query(`select * from public.attach_vault_hub_reference($1, $2)`, [paymentId, 'TS-LATE']),
      )
      expect(message).toMatch(/no longer waiting/i)
    })
  })

  it('refuses a payment that does not exist', async () => {
    await withRollback(async (tx) => {
      const message = await expectRejection(tx, () =>
        tx.query(`select * from public.attach_vault_hub_reference(gen_random_uuid(), $1)`, ['TS-GHOST']),
      )
      expect(message).toMatch(/not found/i)
    })
  })
})

describe.skipIf(!HAS_DB)('closing a deposit that did not complete', () => {
  it('records the reason, so the buyer is not left on a spinner', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)

      await tx.query(`select * from public.fail_vault_payment($1, $2)`, [
        paymentId,
        'The payment did not complete',
      ])

      const after = await payment(tx, paymentId)
      expect(after.status).toBe('failed')
      expect(after.failure_reason).toBe('The payment did not complete')
      expect(await investments(tx, paymentId)).toHaveLength(0)
    })
  })

  it('is idempotent, because the hub retries and the sweep arrives too', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)

      await tx.query(`select * from public.fail_vault_payment($1, $2)`, [paymentId, 'First answer'])
      await tx.query(`select * from public.fail_vault_payment($1, $2)`, [paymentId, 'Second answer'])

      /* The first reason stands. A retry must not rewrite the record of why. */
      expect((await payment(tx, paymentId)).failure_reason).toBe('First answer')
    })
  })

  it('never walks back a confirmation', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID'])

      await tx.query(`select * from public.fail_vault_payment($1, $2)`, [paymentId, 'A late failure'])

      /* A `payment.failed` arriving after a success must not cancel a deposit
         that was really paid for. */
      const after = await payment(tx, paymentId)
      expect(after.status).toBe('confirmed')
      expect(await investments(tx, paymentId)).toHaveLength(1)
    })
  })
})

describe.skipIf(!HAS_DB)('confirming a deposit, and when it may still be confirmed', () => {
  it('opens the investment and clears the reason it had been closed for', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx, { priceGhs: 200, periodDays: 30, dailyReturnPercent: 1 })
      const buyer = await createUser(tx, { name: 'The Late Depositor' })
      const paymentId = await startDeposit(tx, buyer.id, plan.id)

      // The sweep closes it at 48 hours, with Paystack never asked.
      await tx.query(`select * from public.fail_vault_payment($1, $2)`, [
        paymentId,
        'The payment did not complete',
      ])
      expect(await investments(tx, paymentId)).toHaveLength(0)

      // The hub's own sweep asks Paystack, finds the money, and tells us.
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-LATE-PAID'])

      const after = await payment(tx, paymentId)
      expect(after.status).toBe('confirmed')
      expect(after.external_reference).toBe('TS-LATE-PAID')
      /* A confirmed row must not still carry the sentence explaining why it
         failed, or support reads it as the current state. */
      expect(after.failure_reason).toBeNull()

      const [investment] = await investments(tx, paymentId)
      expect(investment!.status).toBe('active')
      // 200 GHS at 1% a day for 30 days: 60 GHS profit, 260 back.
      expect(Number(investment!.expected_return_minor)).toBe(26000)

      /* A buyer was told this had not worked and it had. Somebody has to know. */
      const raised = await alerts(tx, 'late_payment_confirmed')
      expect(raised).toHaveLength(1)
      expect(raised[0]!.context).toMatchObject({ kind: 'vault' })
    })
  })

  it('refuses to confirm a deposit that was refunded', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID'])
      await tx.query(`select * from public.reverse_vault_payment($1, $2)`, [paymentId, 'Chargeback'])

      /* Money that was given back must not become a live investment again on
         the strength of a late or replayed event. */
      const message = await expectRejection(tx, () =>
        tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID']),
      )
      expect(message).toMatch(/refunded/i)
      expect((await investments(tx, paymentId))[0]!.status).toBe('cancelled')
    })
  })

  it('confirms once however many times it is told', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)

      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID'])
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID'])

      /* The return page and the confirm endpoint race each other by design. A
         second investment would pay the yield twice. */
      expect(await investments(tx, paymentId)).toHaveLength(1)
    })
  })
})

describe.skipIf(!HAS_DB)('reversing a deposit the provider gave back', () => {
  it('cancels an investment that was never claimed, and moves no points', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID'])

      await tx.query(`select * from public.reverse_vault_payment($1, $2)`, [paymentId, 'Reversed'])

      expect((await payment(tx, paymentId)).status).toBe('refunded')
      expect((await investments(tx, paymentId))[0]!.status).toBe('cancelled')
      /* Nothing had been paid out, so there is nothing to recover and nothing
         to alert anybody about. */
      expect(await balanceOf(tx, buyer.id)).toBe(0)
      expect(await alerts(tx, 'vault_clawback_short')).toHaveLength(0)
    })
  })

  it('takes back the points a matured vault had already paid out', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: 100 })
      const plan = await aVaultPlan(tx, { priceGhs: 200, periodDays: 30, dailyReturnPercent: 1 })
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID'])

      const [investment] = await investments(tx, paymentId)
      await matureIt(tx, investment!.id)
      await tx.query(`select * from public.claim_vault_investment($1)`, [investment!.id])

      // 260 GHS back at 100 points to the cedi.
      const paidOut = await balanceOf(tx, buyer.id)
      expect(paidOut).toBe(26000)

      await tx.query(`select * from public.reverse_vault_payment($1, $2)`, [paymentId, 'Chargeback'])

      expect(await balanceOf(tx, buyer.id)).toBe(0)
      expect((await investments(tx, paymentId))[0]!.status).toBe('cancelled')
      expect(await alerts(tx, 'vault_clawback_short')).toHaveLength(0)
    })
  })

  it('takes only what is there when the payout was already spent, and says so', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: 100 })
      const plan = await aVaultPlan(tx, { priceGhs: 200, periodDays: 30, dailyReturnPercent: 1 })
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID'])

      const [investment] = await investments(tx, paymentId)
      await matureIt(tx, investment!.id)
      await tx.query(`select * from public.claim_vault_investment($1)`, [investment!.id])

      // They spend most of it before the reversal arrives.
      await tx.query(
        `select public.debit_points($1, $2::bigint, 'admin_adjustment', 'test', 'spent', '{}'::jsonb)`,
        [buyer.id, 20000],
      )
      expect(await balanceOf(tx, buyer.id)).toBe(6000)

      await tx.query(`select * from public.reverse_vault_payment($1, $2)`, [paymentId, 'Chargeback'])

      /* ⚠️ NEVER NEGATIVE. A refund the customer may not have asked for must
         not turn them into a debtor. */
      expect(await balanceOf(tx, buyer.id)).toBe(0)

      /* And the platform is out the difference, which nobody would otherwise
         know. */
      const raised = await alerts(tx, 'vault_clawback_short')
      expect(raised).toHaveLength(1)
      expect(raised[0]!.context).toMatchObject({
        owed_points: 26000,
        recovered_points: 6000,
        user_id: buyer.id,
      })
    })
  })

  it('is idempotent, and does not claw back twice', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: 100 })
      const plan = await aVaultPlan(tx, { priceGhs: 200, periodDays: 30, dailyReturnPercent: 1 })
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)
      await tx.query(`select * from public.confirm_vault_payment($1, $2)`, [paymentId, 'TS-PAID'])

      const [investment] = await investments(tx, paymentId)
      await matureIt(tx, investment!.id)
      await tx.query(`select * from public.claim_vault_investment($1)`, [investment!.id])
      await tx.query(`select public.credit_points($1, 5000, 'ad_view')`, [buyer.id])

      await tx.query(`select * from public.reverse_vault_payment($1, $2)`, [paymentId, 'Chargeback'])
      const afterFirst = await balanceOf(tx, buyer.id)

      await tx.query(`select * from public.reverse_vault_payment($1, $2)`, [paymentId, 'Chargeback'])

      /* A second delivery of the same reversal must not reach the balance
         again: the earnings they have since made are not the platform's. */
      expect(await balanceOf(tx, buyer.id)).toBe(afterFirst)
      expect(afterFirst).toBe(5000)
    })
  })

  it('closes a deposit that never confirmed rather than raising', async () => {
    await withRollback(async (tx) => {
      const plan = await aVaultPlan(tx)
      const buyer = await createUser(tx)
      const paymentId = await startDeposit(tx, buyer.id, plan.id)

      /* Odd, but not worth making the hub retry for 24 hours over. */
      await tx.query(`select * from public.reverse_vault_payment($1, $2)`, [paymentId, 'Reversed early'])

      const after = await payment(tx, paymentId)
      expect(after.status).toBe('failed')
      expect(after.failure_reason).toBe('Reversed early')
      expect(await investments(tx, paymentId)).toHaveLength(0)
    })
  })
})
