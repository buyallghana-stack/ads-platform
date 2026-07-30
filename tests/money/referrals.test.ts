import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type TestUser,
  type Tx,
  balanceOf,
  createAdmin,
  createUser,
  expectRejection,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * The referral programme — all three stages.
 *
 * Stage three (a commission when a referee BUYS A PLAN) is the one that moves
 * the most money per event and the one with the least room for error: it pays
 * out of subscription revenue, it is driven by a webhook that retries, and it
 * is the arm of the programme that fraud rules care about. Most of what is
 * below is about the limits, not the happy path.
 *
 * Every amount here is derived from the seeded plan prices and the peg
 * (1000 points = GHS 1), never hardcoded twice: Gold is GHS 100 = 100_000
 * points, Silver GHS 50 = 50_000, Bronze GHS 20 = 20_000.
 */

const POINTS_PER_CEDI = 1_000

type Plan = { id: string; priceMinor: number; periodDays: number }

async function plan(tx: Tx, slug: string): Promise<Plan> {
  const { rows } = await tx.query<{ id: string; price_minor: string; billing_period_days: number }>(
    `select id, price_minor, billing_period_days from public.tiers where slug = $1`,
    [slug],
  )
  const row = rows[0]!
  return { id: row.id, priceMinor: Number(row.price_minor), periodDays: row.billing_period_days }
}

/** What a plan purchase is worth in points, before any commission. */
const saleInPoints = (p: Plan) => (p.priceMinor * POINTS_PER_CEDI) / 100

/**
 * A confirmed purchase, made the way Paystack makes one: a pending payment
 * row, then `confirm_subscription_payment`. Going straight to the subscription
 * table would skip the entire code path under test.
 */
async function buy(tx: Tx, userId: string, slug: string) {
  const p = await plan(tx, slug)
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.subscription_payments
       (user_id, tier_id, method, status, amount_minor, period_days)
     values ($1, $2, 'paystack', 'pending', $3, $4)
     returning id`,
    [userId, p.id, p.priceMinor, p.periodDays],
  )
  const paymentId = rows[0]!.id
  await confirm(tx, paymentId)
  return { paymentId, plan: p }
}

const confirm = (tx: Tx, paymentId: string) =>
  tx.query(`select public.confirm_subscription_payment($1, $2, '{}'::jsonb)`, [
    paymentId,
    `test-${paymentId}`,
  ])

async function commissionFor(tx: Tx, paymentId: string) {
  const { rows } = await tx.query(
    `select points::bigint::int as points, percent_applied, tier_multiplier, scope_at_payment,
            reversed_at
       from public.referral_commissions where payment_id = $1`,
    [paymentId],
  )
  return rows[0] ?? null
}

/** Alice refers Bob. Returns both, and the referral row id. */
async function refer(tx: Tx): Promise<{ referrer: TestUser; referee: TestUser; referralId: string }> {
  const referrer = await createUser(tx, { name: 'Referrer' })
  const referee = await createUser(tx, { name: 'Referee' })

  const { rows: code } = await tx.query<{ referral_code: string }>(
    `select referral_code from public.profiles where id = $1`,
    [referrer.id],
  )
  const { rows } = await tx.query<{ id: string }>(
    `select (public.apply_referral_code($1, $2)).id`,
    [referee.id, code[0]!.referral_code],
  )

  return { referrer, referee, referralId: rows[0]!.id }
}

/** The default posture for stage three: on, 10%, first purchase of each plan. */
async function enableCommission(tx: Tx, percent = '10') {
  await setConfig(tx, 'referral_purchase_commission_percent', percent)
  await setConfig(tx, 'referral_purchase_commission_scope', 'new_plans')
  await setConfig(tx, 'referral_purchase_commission_cap_points', '0')
}

describe.skipIf(!HAS_DB)('stage three — commission when a referee buys a plan', () => {
  it('pays the configured percentage of what was actually paid', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const { referrer, referee } = await refer(tx)

      const before = await balanceOf(tx, referrer.id)
      const { paymentId, plan: gold } = await buy(tx, referee.id, 'gold')
      const after = await balanceOf(tx, referrer.id)

      // The percentage alone — nothing scales it.
      const expected = saleInPoints(gold) * 0.1

      expect(await commissionFor(tx, paymentId)).toMatchObject({ points: expected })
      expect(after - before).toBe(expected)
    })
  })

  /* Operator correction, 2026-07-30: only AD EARNING scales with a plan.
     A referral used to be worth 2x to a Platinum holder, so the same invited
     person doing the same thing paid different amounts depending on who
     invited them. */
  it('pays the same commission whatever plan the referrer holds', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const { referrer, referee } = await refer(tx)

      // Platinum carries referral_bonus_multiplier 2.0 and must not matter.
      await buy(tx, referrer.id, 'platinum')
      const { paymentId, plan: gold } = await buy(tx, referee.id, 'gold')

      expect(await commissionFor(tx, paymentId)).toMatchObject({
        points: saleInPoints(gold) * 0.1,
        tier_multiplier: '1.000',
      })
    })
  })

  /* The signup and activation bonuses were multiplied too. Same rule. */
  it('pays flat signup and activation bonuses whatever plan the referrer holds', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'referral_signup_bonus_points', '500')
      await setConfig(tx, 'referral_activation_bonus_points', '800')
      await setConfig(tx, 'referral_activation_ads_required', '1')

      const paid = async (plan: string | null) => {
        const referrer = await createUser(tx, { name: 'Referrer ' + (plan ?? 'free') })
        const referee = await createUser(tx, { name: 'Referee ' + (plan ?? 'free') })
        if (plan) await buy(tx, referrer.id, plan)

        const { rows: code } = await tx.query(
          `select referral_code from public.profiles where id = $1`, [referrer.id])
        await tx.query(`select public.apply_referral_code($1, $2)`, [referee.id, code[0].referral_code])

        // One ad completion trips activation.
        await tx.query(`select public.credit_points($1, 100, 'ad_view')`, [referee.id])
        await tx.query(`select public.check_referral_activation($1)`, [referee.id])

        const { rows } = await tx.query(
          `select coalesce(sum(amount), 0)::bigint::int as total from public.points_ledger
            where user_id = $1 and entry_type in ('referral_signup','referral_activation')`,
          [referrer.id])
        return rows[0].total
      }

      // Free referrer and a Platinum referrer must be paid identically.
      expect(await paid(null)).toBe(1300)
      expect(await paid('platinum')).toBe(1300)
    })
  })

  it('is switched off entirely by a percentage of zero', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx, '0')
      const { referrer, referee } = await refer(tx)

      const before = await balanceOf(tx, referrer.id)
      const { paymentId } = await buy(tx, referee.id, 'gold')

      // Not a zero-point row: no row and no ledger entry at all.
      expect(await commissionFor(tx, paymentId)).toBeNull()
      expect(await balanceOf(tx, referrer.id)).toBe(before)
    })
  })

  it('generates nothing for a buyer who was never referred', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const loner = await createUser(tx)
      const { paymentId } = await buy(tx, loner.id, 'gold')
      expect(await commissionFor(tx, paymentId)).toBeNull()
    })
  })
})

describe.skipIf(!HAS_DB)('stage three — which purchases earn', () => {
  it('new_plans: pays for each distinct plan but not for a renewal', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const { referee } = await refer(tx)

      const first = await buy(tx, referee.id, 'gold')
      const renewal = await buy(tx, referee.id, 'gold')
      const other = await buy(tx, referee.id, 'silver')

      expect(await commissionFor(tx, first.paymentId)).toMatchObject({
        points: saleInPoints(first.plan) * 0.1,
      })
      expect(await commissionFor(tx, renewal.paymentId)).toBeNull()
      expect(await commissionFor(tx, other.paymentId)).toMatchObject({
        points: saleInPoints(other.plan) * 0.1,
      })
    })
  })

  it('first: pays once and never again', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      await setConfig(tx, 'referral_purchase_commission_scope', 'first')
      const { referee } = await refer(tx)

      const first = await buy(tx, referee.id, 'bronze')
      const second = await buy(tx, referee.id, 'gold')

      expect(await commissionFor(tx, first.paymentId)).not.toBeNull()
      expect(await commissionFor(tx, second.paymentId)).toBeNull()
    })
  })

  it('all: pays on renewals too', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      await setConfig(tx, 'referral_purchase_commission_scope', 'all')
      const { referee } = await refer(tx)

      const first = await buy(tx, referee.id, 'gold')
      const renewal = await buy(tx, referee.id, 'gold')

      expect(await commissionFor(tx, first.paymentId)).not.toBeNull()
      expect(await commissionFor(tx, renewal.paymentId)).not.toBeNull()
    })
  })

  it('refuses a scope no branch implements, rather than silently picking one', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // The trap migration 052 was written for: a text setting has no CHECK to
      // constrain it, so an unrecognised value would fall through to the
      // else-branch and quietly behave as `new_plans` while looking saved.
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_set_config($1, $2::jsonb)`, [
          admin.id,
          JSON.stringify({ referral_purchase_commission_scope: 'every_single_time' }),
        ]),
      )
      expect(message).toMatch(/must be one of/i)
    })
  })
})

describe.skipIf(!HAS_DB)('stage three — the limits that stop it running away', () => {
  it('never pays out more than the sale brought in', async () => {
    await withRollback(async (tx) => {
      // The worst case the config permits: the maximum percentage, paid to a
      // referrer holding every plan. 50% × 2.85 is 142% of the sale, and a
      // referral must never cost more than the purchase that triggered it.
      await enableCommission(tx, '50')
      const { referrer, referee } = await refer(tx)

      for (const slug of ['bronze', 'silver', 'gold', 'platinum']) {
        await buy(tx, referrer.id, slug)
      }

      const { paymentId, plan: gold } = await buy(tx, referee.id, 'gold')
      const sale = saleInPoints(gold)

      /*
        Since bonuses went flat there is nothing that can push a commission
        past the sale: the percentage is capped at 50 by the config row's own
        bounds, and nothing multiplies it. The clamp is now an invariant with
        nothing to clamp, so this asserts the PROPERTY rather than pretending
        to trigger it — a referral never costs more than the purchase, even
        with the maximum percentage and every plan held.
      */
      expect(await commissionFor(tx, paymentId)).toMatchObject({ points: sale * 0.5 })
      expect(sale * 0.5).toBeLessThanOrEqual(sale)
    })
  })

  it('pays the remainder of a lifetime cap, then stops', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      await setConfig(tx, 'referral_purchase_commission_cap_points', '12000')
      const { referee } = await refer(tx)

      // 10% of Gold is 10_000, leaving 2_000 of the cap. Silver would be
      // 5_000 and must be trimmed to what is left, not refused outright.
      const gold = await buy(tx, referee.id, 'gold')
      const silver = await buy(tx, referee.id, 'silver')
      const bronze = await buy(tx, referee.id, 'bronze')

      expect(await commissionFor(tx, gold.paymentId)).toMatchObject({ points: 10_000 })
      expect(await commissionFor(tx, silver.paymentId)).toMatchObject({ points: 2_000 })
      expect(await commissionFor(tx, bronze.paymentId)).toBeNull()
    })
  })

  it('pays nothing to a disabled referrer', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const { referrer, referee } = await refer(tx)
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [referrer.id])

      const { paymentId } = await buy(tx, referee.id, 'gold')
      expect(await commissionFor(tx, paymentId)).toBeNull()
    })
  })

  it('pays nothing on a referral an admin has rejected', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const admin = await createAdmin(tx)
      const { referee, referralId } = await refer(tx)

      await tx.query(`select public.reject_referral($1, $2, $3)`, [
        admin.id,
        referralId,
        'fraud review',
      ])

      const { paymentId } = await buy(tx, referee.id, 'gold')
      expect(await commissionFor(tx, paymentId)).toBeNull()
    })
  })
})

describe.skipIf(!HAS_DB)('stage three — paying exactly once', () => {
  it('does not pay a second time when the webhook retries', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const { referrer, referee } = await refer(tx)
      const { paymentId } = await buy(tx, referee.id, 'gold')

      const afterFirst = await balanceOf(tx, referrer.id)

      // Paystack's webhook and the browser callback both confirm, and the
      // webhook is retried on any non-200. All three must be one payment.
      await confirm(tx, paymentId)
      await confirm(tx, paymentId)

      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.referral_commissions where payment_id = $1`,
        [paymentId],
      )
      expect(rows[0]!.n).toBe(1)
      expect(await balanceOf(tx, referrer.id)).toBe(afterFirst)
    })
  })

  it('cannot be credited twice for the same payment even directly', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const { referrer, referee } = await refer(tx)
      const { paymentId } = await buy(tx, referee.id, 'gold')
      const afterFirst = await balanceOf(tx, referrer.id)

      // Bypassing confirm_subscription_payment entirely: the guard has to be
      // in the data, not in the caller. points_ledger_source_once_idx and the
      // unique payment_id are the two that hold here.
      await expectRejection(tx, () =>
        tx.query(`select public.pay_referral_purchase_commission($1)`, [paymentId]),
      )
      expect(await balanceOf(tx, referrer.id)).toBe(afterFirst)
    })
  })

  it('never lets a failed commission cost somebody the plan they paid for', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const { referee } = await refer(tx)

      // The global earning pause blocks credit_points, which is exactly the
      // kind of failure that must not propagate: the money for this plan has
      // already left the buyer's account.
      await setConfig(tx, 'earning_paused_globally', 'true')
      const { paymentId } = await buy(tx, referee.id, 'gold')

      const { rows: subs } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.user_subscriptions
          where user_id = $1 and status in ('active', 'grace')`,
        [referee.id],
      )
      const { rows: alerts } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.system_alerts
          where code = 'referral_commission_failed'
            and context ->> 'payment_id' = $1`,
        [paymentId],
      )

      expect(subs[0]!.n).toBe(1)
      expect(await commissionFor(tx, paymentId)).toBeNull()
      // Silence would mean nobody ever finds out a commission was skipped.
      expect(alerts[0]!.n).toBe(1)
    })
  })
})

describe.skipIf(!HAS_DB)('stage three — reversal', () => {
  it('claws back every commission when an admin rejects the referral', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const admin = await createAdmin(tx)
      const { referrer, referee, referralId } = await refer(tx)

      await buy(tx, referee.id, 'gold')
      await buy(tx, referee.id, 'silver')

      const earned = await balanceOf(tx, referrer.id)
      expect(earned).toBe(15_000) // 10% of GHS 150

      await tx.query(`select public.reject_referral($1, $2, $3)`, [
        admin.id,
        referralId,
        'device farm',
      ])

      expect(await balanceOf(tx, referrer.id)).toBe(0)

      const { rows } = await tx.query<{ unreversed: number }>(
        `select count(*) filter (where reversed_at is null)::int as unreversed
           from public.referral_commissions where referral_id = $1`,
        [referralId],
      )
      expect(rows[0]!.unreversed).toBe(0)
    })
  })

  it('leaves the referee their plan and their own earnings', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const admin = await createAdmin(tx)
      const { referee, referralId } = await refer(tx)

      await buy(tx, referee.id, 'gold')
      await tx.query(`select public.credit_points($1, 3000, 'ad_view')`, [referee.id])

      await tx.query(`select public.reject_referral($1, $2, $3)`, [
        admin.id,
        referralId,
        'referrer was farming',
      ])

      // They may simply have been recruited by somebody abusive. They paid
      // real money for the plan and did real watching for the points.
      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.user_subscriptions
          where user_id = $1 and status = 'active'`,
        [referee.id],
      )
      expect(rows[0]!.n).toBe(1)
      expect(await balanceOf(tx, referee.id)).toBe(3_000)
    })
  })

  it('takes only what is there rather than driving a balance negative', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const admin = await createAdmin(tx)
      const { referrer, referee, referralId } = await refer(tx)

      await buy(tx, referee.id, 'gold') // referrer earns 10_000

      // The referrer spends most of it before anyone notices the fraud.
      await tx.query(
        `select public.debit_points($1, 9000, 'admin_adjustment', 'test', 'spend')`,
        [referrer.id],
      )
      expect(await balanceOf(tx, referrer.id)).toBe(1_000)

      await tx.query(`select public.reject_referral($1, $2, $3)`, [
        admin.id,
        referralId,
        'fraud',
      ])

      // A negative balance is not representable, and chasing the shortfall
      // would be worse than recording that it could not be fully recovered.
      expect(await balanceOf(tx, referrer.id)).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('what the referral screen is told', () => {
  it('counts commission points in the total earned from invites', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      await setConfig(tx, 'referral_signup_bonus_points', '500')
      const { referrer, referee } = await refer(tx)

      await buy(tx, referee.id, 'gold')

      const { rows } = await tx.query(
        `select * from public.get_referral_summary($1)`,
        [referrer.id],
      )
      expect(rows[0]).toMatchObject({
        total_referred: 1,
        purchases_count: 1,
        commission_points: '10000',
        // 500 signup + 10_000 commission. Leaving stage three out would make
        // the card understate what invites actually paid.
        points_earned: '10500',
      })
    })
  })

  it('stops counting a commission once it has been reversed', async () => {
    await withRollback(async (tx) => {
      await enableCommission(tx)
      const admin = await createAdmin(tx)
      const { referrer, referee, referralId } = await refer(tx)

      await buy(tx, referee.id, 'gold')
      await tx.query(`select public.reject_referral($1, $2, $3)`, [admin.id, referralId, 'fraud'])

      const { rows } = await tx.query(
        `select * from public.get_referral_summary($1)`,
        [referrer.id],
      )
      expect(rows[0]).toMatchObject({ purchases_count: 0, commission_points: '0' })
    })
  })
})
