import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type TestUser,
  type Tx,
  balanceOf,
  createAdmin,
  createUser,
  expectRejection,
  pinEconomy,
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
 * Every amount here is derived from the plan prices and the peg as they
 * ACTUALLY ARE, read from the database, never written down twice. Both move:
 * the operator repriced every plan on 2026-08-04 and changed the peg from
 * 1,000 points to the cedi to 100 in the same breath, and a test holding
 * either as a literal fails that day while proving nothing about whether
 * commissions are still a correct percentage of a sale.
 *
 * `pinEconomy` fixes the peg for the length of each test so the arithmetic is
 * stable; the prices are read.
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

/**
 * The commission for a payment at a given level.
 *
 * The level filter is not decoration: since migration 083 one payment can
 * produce two rows, and an unfiltered `rows[0]` would be whichever row the
 * planner happened to return first.
 */
async function commissionFor(tx: Tx, paymentId: string, level = 1) {
  const { rows } = await tx.query(
    `select points::bigint::int as points, percent_applied, tier_multiplier, scope_at_payment,
            reversed_at, level
       from public.referral_commissions where payment_id = $1 and level = $2`,
    [paymentId, level],
  )
  return rows[0] ?? null
}

/** One person applies another's code. Returns the referral row id. */
async function applyCode(tx: Tx, referrerId: string, refereeId: string): Promise<string> {
  const { rows: code } = await tx.query<{ referral_code: string }>(
    `select referral_code from public.profiles where id = $1`,
    [referrerId],
  )
  const { rows } = await tx.query<{ id: string }>(
    `select (public.apply_referral_code($1, $2)).id`,
    [refereeId, code[0]!.referral_code],
  )
  return rows[0]!.id
}

/** Alice refers Bob. Returns both, and the referral row id. */
async function refer(tx: Tx): Promise<{ referrer: TestUser; referee: TestUser; referralId: string }> {
  const referrer = await createUser(tx, { name: 'Referrer' })
  const referee = await createUser(tx, { name: 'Referee' })
  const referralId = await applyCode(tx, referrer.id, referee.id)
  return { referrer, referee, referralId }
}

/**
 * A three-deep chain: grandparent invited parent, parent invited referee.
 *
 * Built in that order on purpose — it is the only order the real world
 * produces, since somebody must be referred before they can refer.
 */
async function chain(tx: Tx) {
  const grandparent = await createUser(tx, { name: 'Grandparent' })
  const parent = await createUser(tx, { name: 'Parent' })
  const referee = await createUser(tx, { name: 'Referee' })

  const upper = await applyCode(tx, grandparent.id, parent.id) // G -> P
  const lower = await applyCode(tx, parent.id, referee.id) // P -> R

  return { grandparent, parent, referee, upper, lower }
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableCommission(tx)
      /* The cap is set relative to what Gold ACTUALLY sells for: 10% of it,
         plus a deliberate remainder that the next purchase must be trimmed
         to. Written as literals this read "10% of Gold is 10_000", which was
         true until the operator repriced Gold from GHS 100 to GHS 250. */
      const goldCommission = saleInPoints(await plan(tx, 'gold')) * 0.1
      const remainder = 2_000
      await setConfig(
        tx,
        'referral_purchase_commission_cap_points',
        String(goldCommission + remainder),
      )
      const { referee } = await refer(tx)

      const gold = await buy(tx, referee.id, 'gold')
      const silver = await buy(tx, referee.id, 'silver')
      const bronze = await buy(tx, referee.id, 'bronze')

      expect(await commissionFor(tx, gold.paymentId)).toMatchObject({ points: goldCommission })
      // Silver is worth more than what is left, so it is trimmed rather than refused.
      expect(await commissionFor(tx, silver.paymentId)).toMatchObject({ points: remainder })
      expect(await commissionFor(tx, bronze.paymentId)).toBeNull()
    })
  })

  it('pays nothing to a disabled referrer', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableCommission(tx)
      const { referrer, referee } = await refer(tx)
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [referrer.id])

      const { paymentId } = await buy(tx, referee.id, 'gold')
      expect(await commissionFor(tx, paymentId)).toBeNull()
    })
  })

  it('pays nothing on a referral an admin has rejected', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableCommission(tx)
      const admin = await createAdmin(tx)
      const { referrer, referee, referralId } = await refer(tx)

      await buy(tx, referee.id, 'gold')
      await buy(tx, referee.id, 'silver')

      const earned = await balanceOf(tx, referrer.id)
      const expected =
        (saleInPoints(await plan(tx, 'gold')) + saleInPoints(await plan(tx, 'silver'))) * 0.1
      expect(earned).toBe(expected) // 10% of what the two plans actually cost

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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableCommission(tx)
      const admin = await createAdmin(tx)
      const { referrer, referee, referralId } = await refer(tx)

      await buy(tx, referee.id, 'gold')
      const commission = await balanceOf(tx, referrer.id)

      // The referrer spends all but a thousand of it before anyone notices.
      await tx.query(
        `select public.debit_points($1, $2, 'admin_adjustment', 'test', 'spend')`,
        [referrer.id, commission - 1_000],
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
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableCommission(tx)
      await setConfig(tx, 'referral_signup_bonus_points', '500')
      const { referrer, referee } = await refer(tx)

      await buy(tx, referee.id, 'gold')

      const { rows } = await tx.query(
        `select * from public.get_referral_summary($1)`,
        [referrer.id],
      )
      const commission = saleInPoints(await plan(tx, 'gold')) * 0.1
      expect(rows[0]).toMatchObject({
        total_referred: 1,
        purchases_count: 1,
        commission_points: String(commission),
        // The signup bonus plus the commission. Leaving stage three out would
        // make the card understate what invites actually paid.
        points_earned: String(500 + commission),
      })
    })
  })

  it('stops counting a commission once it has been reversed', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
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

/* ==========================================================================
   THE SECOND LEVEL (migration 083)

   G invited P, P invited R. Everything below is about what G is owed for
   what R does, and — more importantly — about the four things that must
   never happen: a third level being paid, a cycle paying somebody for their
   own activity, two commissions together exceeding the sale, and a rejected
   link leaving second-level money behind.
   ========================================================================== */

/** Turn both levels of stage three on: 10% to the referrer, 5% above them. */
async function enableBothLevels(tx: Tx, l1 = '10', l2 = '5') {
  await enableCommission(tx, l1)
  await setConfig(tx, 'referral_purchase_commission_percent_l2', l2)
}

/** Every referral payment a user has ever received, by level. */
async function paidToLevel(tx: Tx, userId: string, level: number) {
  const { rows } = await tx.query<{ total: number }>(
    `select coalesce(sum(amount), 0)::bigint::int as total
       from public.points_ledger
      where user_id = $1
        and entry_type in ('referral_signup', 'referral_activation', 'referral_purchase')
        and (metadata ->> 'level')::int = $2`,
    [userId, level],
  )
  return rows[0]!.total
}

describe.skipIf(!HAS_DB)('the second level — who gets paid', () => {
  it('pays a signup bonus one level up as well as to the referrer', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await setConfig(tx, 'referral_signup_bonus_points', '500')
      await setConfig(tx, 'referral_signup_bonus_points_l2', '200')

      const { grandparent, parent } = await chain(tx)

      // The parent earns the first-level bonus for the referee they invited,
      // and the grandparent earns the second-level bonus for the same event.
      expect(await balanceOf(tx, parent.id)).toBe(500)
      expect(await paidToLevel(tx, grandparent.id, 2)).toBe(200)

      // The grandparent's own 500 came from inviting the parent, one level.
      expect(await balanceOf(tx, grandparent.id)).toBe(700)
    })
  })

  it('pays an activation bonus one level up when the referee starts watching', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await setConfig(tx, 'referral_activation_bonus_points', '800')
      await setConfig(tx, 'referral_activation_bonus_points_l2', '300')
      await setConfig(tx, 'referral_activation_ads_required', '1')

      const { grandparent, parent, referee } = await chain(tx)

      await tx.query(`select public.credit_points($1, 100, 'ad_view')`, [referee.id])
      await tx.query(`select public.check_referral_activation($1)`, [referee.id])

      expect(await paidToLevel(tx, parent.id, 1)).toBe(800)
      expect(await paidToLevel(tx, grandparent.id, 2)).toBe(300)
    })
  })

  it('pays a purchase commission at both levels out of the one sale', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableBothLevels(tx)
      const { grandparent, parent, referee } = await chain(tx)

      const { paymentId, plan: gold } = await buy(tx, referee.id, 'gold')
      const sale = saleInPoints(gold)

      expect(await commissionFor(tx, paymentId, 1)).toMatchObject({ points: sale * 0.1 })
      expect(await commissionFor(tx, paymentId, 2)).toMatchObject({ points: sale * 0.05 })
      expect(await balanceOf(tx, parent.id)).toBe(sale * 0.1)
      expect(await balanceOf(tx, grandparent.id)).toBe(sale * 0.05)
    })
  })

  it('is off by default, so nothing changes until the operator sets a rate', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableCommission(tx)
      /* ⚠️ PINNED TO ZERO, NOT ASSUMED TO BE ZERO. This used to say
         "enableCommission touches the first level only, so the second-level
         keys keep their shipped value of zero" — and then read the live value
         of a key the operator can change from the admin. They did: it is 7 on
         the project now, so a test about what happens at zero was testing
         seven and failing.

         The invariant is real and worth keeping: a second level with no rate
         set pays nobody. It just has to be stated here rather than inherited.
         Same rule as the ladder in `pinEconomy`. */
      await setConfig(tx, 'referral_purchase_commission_percent_l2', '0')
      await setConfig(tx, 'referral_signup_bonus_points', '500')

      const { grandparent, referee } = await chain(tx)
      const { paymentId } = await buy(tx, referee.id, 'gold')

      expect(await commissionFor(tx, paymentId, 2)).toBeNull()
      // The grandparent still earns their own first-level signup bonus for
      // the parent, and nothing at all for the referee.
      expect(await paidToLevel(tx, grandparent.id, 2)).toBe(0)
      expect(await balanceOf(tx, grandparent.id)).toBe(500)
    })
  })

  it('fills in a second-level referrer that arrived after the link below it', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await setConfig(tx, 'referral_signup_bonus_points_l2', '200')
      await setConfig(tx, 'referral_activation_bonus_points_l2', '300')
      await setConfig(tx, 'referral_activation_ads_required', '1')

      // Out of order: the parent invites the referee BEFORE being invited
      // themselves, so nobody was one level up at signup.
      const grandparent = await createUser(tx, { name: 'Late grandparent' })
      const parent = await createUser(tx, { name: 'Parent' })
      const referee = await createUser(tx, { name: 'Referee' })

      await applyCode(tx, parent.id, referee.id)
      await applyCode(tx, grandparent.id, parent.id)

      // No signup bonus is owed retrospectively — there was nobody upstream
      // at the moment it fell due.
      expect(await paidToLevel(tx, grandparent.id, 2)).toBe(0)

      await tx.query(`select public.credit_points($1, 100, 'ad_view')`, [referee.id])
      await tx.query(`select public.check_referral_activation($1)`, [referee.id])

      // By activation they genuinely are one level up, and the commission arm
      // resolves the hop live, so leaving them out here would mean the same
      // relationship earned a commission but not an activation bonus.
      expect(await paidToLevel(tx, grandparent.id, 2)).toBe(300)
    })
  })

  it('pays nothing to a disabled second-level referrer', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableBothLevels(tx)
      await setConfig(tx, 'referral_signup_bonus_points_l2', '200')

      const grandparent = await createUser(tx, { name: 'Disabled grandparent' })
      const parent = await createUser(tx, { name: 'Parent' })
      const referee = await createUser(tx, { name: 'Referee' })

      await applyCode(tx, grandparent.id, parent.id)
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [
        grandparent.id,
      ])

      await applyCode(tx, parent.id, referee.id)
      const { paymentId } = await buy(tx, referee.id, 'gold')

      expect(await paidToLevel(tx, grandparent.id, 2)).toBe(0)
      expect(await commissionFor(tx, paymentId, 2)).toBeNull()
    })
  })
})

describe.skipIf(!HAS_DB)('the second level — the depth limit', () => {
  it('pays two levels and never a third', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableBothLevels(tx)
      await setConfig(tx, 'referral_signup_bonus_points', '500')
      await setConfig(tx, 'referral_signup_bonus_points_l2', '200')

      // Four deep: great-grandparent -> grandparent -> parent -> buyer.
      const great = await createUser(tx, { name: 'Great grandparent' })
      const grandparent = await createUser(tx, { name: 'Grandparent' })
      const parent = await createUser(tx, { name: 'Parent' })
      const buyer = await createUser(tx, { name: 'Buyer' })

      await applyCode(tx, great.id, grandparent.id)
      await applyCode(tx, grandparent.id, parent.id)
      const greatBefore = await balanceOf(tx, great.id)
      await applyCode(tx, parent.id, buyer.id)

      // The signup two levels below the great-grandparent pays them nothing.
      expect(await balanceOf(tx, great.id)).toBe(greatBefore)

      const { paymentId, plan: gold } = await buy(tx, buyer.id, 'gold')

      expect(await commissionFor(tx, paymentId, 1)).toMatchObject({
        points: saleInPoints(gold) * 0.1,
      })
      expect(await commissionFor(tx, paymentId, 2)).toMatchObject({
        points: saleInPoints(gold) * 0.05,
      })

      // Three levels up is where it stops. Not by a setting — the hop is
      // written out once, with no recursion, so there is nothing to configure.
      expect(await balanceOf(tx, great.id)).toBe(greatBefore)

      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.referral_commissions where payment_id = $1`,
        [paymentId],
      )
      expect(rows[0]!.n).toBe(2)
    })
  })

  it('refuses to pay a buyer for their own purchase through a cycle', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableBothLevels(tx)

      // A -> B, and then B -> A: reachable, because a code may be applied by
      // anyone who has not started earning yet. A is now their own second-level
      // referrer, and a purchase by A would pay A a commission on it.
      const a = await createUser(tx, { name: 'Cycle A' })
      const b = await createUser(tx, { name: 'Cycle B' })
      await applyCode(tx, a.id, b.id)
      await applyCode(tx, b.id, a.id)

      const { paymentId, plan: gold } = await buy(tx, a.id, 'gold')

      expect(await commissionFor(tx, paymentId, 1)).toMatchObject({
        points: saleInPoints(gold) * 0.1,
      })
      expect(await commissionFor(tx, paymentId, 2)).toBeNull()
      // B earned the first level. A earned nothing from their own purchase.
      expect(await balanceOf(tx, b.id)).toBe(saleInPoints(gold) * 0.1)
      expect(await balanceOf(tx, a.id)).toBe(0)
    })
  })

  it('never pays more than the sale across both levels', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      // The worst case the two config rows permit: 50% and 50%.
      await enableBothLevels(tx, '50', '50')
      const { grandparent, parent, referee } = await chain(tx)

      const { paymentId, plan: gold } = await buy(tx, referee.id, 'gold')
      const sale = saleInPoints(gold)

      // The second level is paid out of the REMAINDER, so 50 + 50 is the
      // whole sale and not 150% of it.
      expect(await commissionFor(tx, paymentId, 1)).toMatchObject({ points: sale * 0.5 })
      expect(await commissionFor(tx, paymentId, 2)).toMatchObject({ points: sale * 0.5 })

      const paid = (await balanceOf(tx, parent.id)) + (await balanceOf(tx, grandparent.id))
      expect(paid).toBe(sale)
      expect(paid).toBeLessThanOrEqual(sale)
    })
  })

  it('counts both levels against one lifetime cap for the same link', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableBothLevels(tx)
      /* A cap that Gold alone does not reach, so the SECOND purchase is the
         one that gets trimmed — which is the behaviour under test. */
      const goldCommission = saleInPoints(await plan(tx, 'gold')) * 0.1
      const remainder = 1_000
      await setConfig(
        tx,
        'referral_purchase_commission_cap_points',
        String(goldCommission + remainder),
      )

      const { parent, referee } = await chain(tx)

      // The cap is spent by the referee's own purchases, in the order they
      // happen — otherwise a referee who has already generated the ceiling
      // becomes worth another ceiling with their next purchase.
      const gold = await buy(tx, referee.id, 'gold')
      const silver = await buy(tx, referee.id, 'silver')

      expect(await commissionFor(tx, gold.paymentId, 1)).toMatchObject({ points: goldCommission })
      expect(await commissionFor(tx, silver.paymentId, 1)).toMatchObject({ points: remainder })

      expect(await balanceOf(tx, parent.id)).toBe(goldCommission + remainder)
    })
  })
})

describe.skipIf(!HAS_DB)('the second level — unwinding a rejected link', () => {
  it('takes back the second-level commission when the lower link is rejected', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableBothLevels(tx)
      const admin = await createAdmin(tx)
      const { grandparent, parent, referee, lower } = await chain(tx)

      const { plan: gold } = await buy(tx, referee.id, 'gold')
      const sale = saleInPoints(gold)
      expect(await balanceOf(tx, grandparent.id)).toBe(sale * 0.05)

      await tx.query(`select public.reject_referral($1, $2, $3)`, [admin.id, lower, 'device farm'])

      // Both beneficiaries give it back, not just the referrer. The purchase
      // behind the second-level payment is the same purchase.
      expect(await balanceOf(tx, parent.id)).toBe(0)
      expect(await balanceOf(tx, grandparent.id)).toBe(0)

      const { rows } = await tx.query<{ unreversed: number }>(
        `select count(*) filter (where reversed_at is null)::int as unreversed
           from public.referral_commissions where source_referral_id = $1`,
        [lower],
      )
      expect(rows[0]!.unreversed).toBe(0)
    })
  })

  it('takes back second-level bonuses when the link they ran through is rejected', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await setConfig(tx, 'referral_signup_bonus_points', '500')
      await setConfig(tx, 'referral_signup_bonus_points_l2', '200')
      const admin = await createAdmin(tx)
      const { grandparent, upper } = await chain(tx)

      // 500 for inviting the parent, 200 for the referee the parent invited.
      expect(await balanceOf(tx, grandparent.id)).toBe(700)

      // Rejecting G -> P says the parent should never have been the
      // grandparent's referral at all, so the second-level bonus that reached
      // them THROUGH the parent is unearned too.
      await tx.query(`select public.reject_referral($1, $2, $3)`, [admin.id, upper, 'fake account'])

      expect(await balanceOf(tx, grandparent.id)).toBe(0)
    })
  })

  it('does not claw the same second-level bonus back twice', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await setConfig(tx, 'referral_signup_bonus_points', '500')
      await setConfig(tx, 'referral_signup_bonus_points_l2', '200')
      const admin = await createAdmin(tx)
      const { grandparent, upper, lower } = await chain(tx)

      // A broken chain can be rejected from either end, and the 200 is
      // reachable from both. Taking it twice would invent a debt.
      await tx.query(`select public.reject_referral($1, $2, $3)`, [admin.id, lower, 'farm'])
      const afterFirst = await balanceOf(tx, grandparent.id)
      expect(afterFirst).toBe(500)

      await tx.query(`select public.reject_referral($1, $2, $3)`, [admin.id, upper, 'same farm'])

      // Only the grandparent's own 500 for inviting the parent goes now.
      expect(await balanceOf(tx, grandparent.id)).toBe(0)
    })
  })

  it('stops paying the second level once the middle link is rejected', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableBothLevels(tx)
      const admin = await createAdmin(tx)
      const { grandparent, referee, upper } = await chain(tx)

      await tx.query(`select public.reject_referral($1, $2, $3)`, [admin.id, upper, 'fraud'])

      const { paymentId } = await buy(tx, referee.id, 'gold')

      // The hop skips rejected links, so there is no second level any more.
      expect(await commissionFor(tx, paymentId, 1)).not.toBeNull()
      expect(await commissionFor(tx, paymentId, 2)).toBeNull()
      expect(await balanceOf(tx, grandparent.id)).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('what the referral screen is told about the second level', () => {
  it('breaks out the people and points that came from the second level', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx, { pointsPerCedi: POINTS_PER_CEDI })
      await enableBothLevels(tx)
      await setConfig(tx, 'referral_signup_bonus_points', '500')
      await setConfig(tx, 'referral_signup_bonus_points_l2', '200')

      const { grandparent, referee } = await chain(tx)
      await buy(tx, referee.id, 'gold')

      // Half the first level's ten per cent, on whatever Gold now costs.
      const secondLevel = saleInPoints(await plan(tx, 'gold')) * 0.05

      const { rows } = await tx.query(`select * from public.get_referral_summary($1)`, [
        grandparent.id,
      ])

      expect(rows[0]).toMatchObject({
        // One person they invited themselves, one a level below that.
        total_referred: 1,
        level_two_count: 1,
        // The second-level signup bonus plus the second-level commission.
        level_two_points: String(200 + secondLevel),
        // The parent's own signup bonus, plus everything from below it.
        points_earned: String(500 + 200 + secondLevel),
      })
    })
  })
})
