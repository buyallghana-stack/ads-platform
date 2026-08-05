import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type TestUser,
  type Tx,
  actAs,
  actAsAdmin,
  createAdmin,
  createUser,
  expectRejection,
  pinEconomy,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * The Team screen's two reads.
 *
 * This file is in the money suite for a reason that is not arithmetic: these
 * are the only functions in the schema that hand ONE user another user's
 * personal and financial data. The operator asked for that, on their lawyer's
 * advice, for transparency — so the tests that matter are the ones about
 * WHERE THE DISCLOSURE STOPS. Two levels and no further, nobody else's team,
 * no cycle putting somebody on their own, and a switch that can retract the
 * phone number.
 *
 * The arithmetic still has to be right, because a figure somebody is being
 * asked to trust is worse than no figure when it is wrong: every amount is
 * cedis, converted at the peg, and only money that actually left counts as
 * withdrawn.
 */

const POINTS_PER_CEDI = 1_000

async function applyCode(tx: Tx, referrerId: string, refereeId: string) {
  const { rows } = await tx.query<{ referral_code: string }>(
    `select referral_code from public.profiles where id = $1`,
    [referrerId],
  )
  await tx.query(`select public.apply_referral_code($1, $2)`, [refereeId, rows[0]!.referral_code])
}

/** Grandparent -> parent -> child, built in the only order reality allows. */
async function chain(tx: Tx) {
  const top = await createUser(tx, { name: 'Top' })
  const first = await createUser(tx, { name: 'First Level' })
  const second = await createUser(tx, { name: 'Second Level' })
  await applyCode(tx, top.id, first.id)
  await applyCode(tx, first.id, second.id)
  return { top, first, second }
}

async function buy(tx: Tx, userId: string, slug: string) {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.subscription_payments (user_id, tier_id, method, status, amount_minor, period_days)
     select $1, t.id, 'paystack', 'pending', t.price_minor, t.billing_period_days
       from public.tiers t where t.slug = $2
     returning id`,
    [userId, slug],
  )
  await tx.query(`select public.confirm_subscription_payment($1, $2, '{}'::jsonb)`, [
    rows[0]!.id,
    `team-${rows[0]!.id}`,
  ])
}

/** A redemption in whatever state the test needs. */
async function redeem(tx: Tx, userId: string, cedis: number, status: string) {
  await tx.query(
    `insert into public.redemptions
       (user_id, status, method, points_amount, points_per_currency_unit, currency_amount,
        holding_until, paid_at, snapshot_provider_code, snapshot_msisdn, snapshot_account_name)
     values ($1, $2::public.redemption_status, 'mobile_money', $3::bigint * 1000,
             public.config_int('points_per_currency_unit'), $3, now(),
             case when $2 = 'paid' then now() end, 'MTN_MOMO', '0241234567', 'Test Person')`,
    [userId, status, cedis],
  )
}

async function summary(tx: Tx, userId: string) {
  const { rows } = await tx.query(`select * from public.get_team_summary($1)`, [userId])
  return {
    1: rows.find((r) => Number(r.member_level) === 1)!,
    2: rows.find((r) => Number(r.member_level) === 2)!,
  }
}

async function members(tx: Tx, userId: string) {
  const { rows } = await tx.query(`select * from public.get_team_members($1)`, [userId])
  return rows as Array<Record<string, string | number | null>>
}

describe.skipIf(!HAS_DB)('the team — who is on it', () => {
  it('separates the people you invited from the people they invited', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, first, second } = await chain(tx)

      const rows = await members(tx, top.id)
      expect(rows).toHaveLength(2)
      expect(rows.find((r) => r.member_id === first.id)!.member_level).toBe(1)
      expect(rows.find((r) => r.member_id === second.id)!.member_level).toBe(2)

      const totals = await summary(tx, top.id)
      expect(Number(totals[1].people)).toBe(1)
      expect(Number(totals[2].people)).toBe(1)
    })
  })

  it('stops at two levels, exactly as the payments do', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, second } = await chain(tx)
      const third = await createUser(tx, { name: 'Third Level' })
      await applyCode(tx, second.id, third.id)

      const rows = await members(tx, top.id)
      // The third level is not filtered out of a longer walk — there is no
      // longer walk. One join, and it ends.
      expect(rows.map((r) => r.member_id)).not.toContain(third.id)
      expect(rows).toHaveLength(2)
    })
  })

  it('never puts somebody on their own team through a cycle', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      // A refers B, then B refers A — reachable, because a code may be applied
      // by anybody who has not started earning. Without the guard A's own
      // balance would be reported as A's team's.
      const a = await createUser(tx, { name: 'Cycle A' })
      const b = await createUser(tx, { name: 'Cycle B' })
      await applyCode(tx, a.id, b.id)
      await applyCode(tx, b.id, a.id)

      const rows = await members(tx, a.id)
      expect(rows.map((r) => r.member_id)).not.toContain(a.id)
      expect(rows.map((r) => r.member_id)).toEqual([b.id])
    })
  })

  it('drops somebody an admin has rejected, and the level below them', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const admin = await createAdmin(tx)
      const { top, first } = await chain(tx)

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.referrals where referee_id = $1`,
        [first.id],
      )
      await tx.query(`select public.reject_referral($1, $2, $3)`, [admin.id, rows[0]!.id, 'farm'])

      // Rejecting the link removes the person AND everything that reached the
      // top through them. A rejected referral is not a referral.
      expect(await members(tx, top.id)).toHaveLength(0)
    })
  })
})

describe.skipIf(!HAS_DB)('the team — the figures', () => {
  it('reports plans and their value in cedis, per level', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, first, second } = await chain(tx)

      await buy(tx, first.id, 'platinum')
      await buy(tx, first.id, 'gold')
      await buy(tx, second.id, 'silver')

      /* Read from the plans rather than written beside them as comments. The
         operator repriced the whole ladder on 2026-08-04, and the figure this
         screen shows a referrer is the sum of what their team actually paid —
         which is the thing worth asserting, not last month's prices. */
      const { rows: prices } = await tx.query<{ slug: string; ghs: string }>(
        `select slug, (price_minor / 100.0)::text as ghs from public.tiers`,
      )
      const price = (slug: string) => Number(prices.find((r) => r.slug === slug)!.ghs)

      const totals = await summary(tx, top.id)
      expect(Number(totals[1].plans_bought)).toBe(2)
      expect(Number(totals[1].plans_value)).toBe(price('platinum') + price('gold'))
      expect(Number(totals[2].plans_bought)).toBe(1)
      expect(Number(totals[2].plans_value)).toBe(price('silver'))
    })
  })

  it('converts what is left to cedis at the peg, never showing points', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, first } = await chain(tx)
      await tx.query(`select public.credit_points($1, 8_400, 'admin_adjustment')`, [first.id])

      const totals = await summary(tx, top.id)
      expect(Number(totals[1].remaining)).toBe(8_400 / POINTS_PER_CEDI)

      const rows = await members(tx, top.id)
      expect(Number(rows[0]!.remaining)).toBe(8.4)
    })
  })

  it('counts money that left, not money that was asked for', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, first } = await chain(tx)
      await tx.query(`select public.credit_points($1, 60_000, 'admin_adjustment')`, [first.id])

      await redeem(tx, first.id, 5, 'paid')
      await redeem(tx, first.id, 9, 'pending_approval')
      await redeem(tx, first.id, 7, 'rejected')

      // A withdrawal in the queue has not been withdrawn, and a refused one
      // never will be. Reporting either as paid would misstate somebody
      // else's finances to a third party.
      const totals = await summary(tx, top.id)
      expect(Number(totals[1].redeemed)).toBe(5)
    })
  })

  it('names the highest plan and counts the rest — "Platinum + 2"', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, first } = await chain(tx)
      for (const slug of ['bronze', 'platinum', 'gold']) await buy(tx, first.id, slug)

      const row = (await members(tx, top.id))[0]!
      expect(row.top_plan).toBe('Platinum')
      expect(Number(row.extra_plans)).toBe(2)
    })
  })

  it('shows the default tier for somebody who holds no plan', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top } = await chain(tx)
      const row = (await members(tx, top.id))[0]!

      // Not a blank, and not "none": holding no paid plan IS a standing.
      expect(row.top_plan).toBe('Free')
      expect(Number(row.extra_plans)).toBe(0)
    })
  })

  it('returns both levels even when the team is empty', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const loner = await createUser(tx)
      const totals = await summary(tx, loner.id)

      // A missing row would leave the screen unable to tell "nothing happened"
      // from "something failed".
      expect(Number(totals[1].people)).toBe(0)
      expect(Number(totals[2].people)).toBe(0)
      expect(Number(totals[1].plans_value)).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('the team — where the disclosure stops', () => {
  it('refuses to show anybody else their team', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, first } = await chain(tx)
      const nosy: TestUser = await createUser(tx, { name: 'Nosy' })

      await actAs(tx, nosy.id)
      const message = await expectRejection(tx, () =>
        tx.query(`select * from public.get_team_members($1)`, [top.id]),
      )
      expect(message).toMatch(/not authorised/i)

      // Being on somebody's team does not let you read it either.
      await actAs(tx, first.id)
      await expectRejection(tx, () =>
        tx.query(`select * from public.get_team_summary($1)`, [top.id]),
      )
    })
  })

  it('lets an admin look, because somebody has to answer a complaint', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const admin = await createAdmin(tx)
      const { top } = await chain(tx)

      // actAsAdmin, not actAs: is_admin() reads the `user_role` CLAIM, not
      // the user_roles table, so the table row alone leaves the session an
      // ordinary user — and this test would then pass for the wrong reason
      // if it were asserting a refusal.
      await actAsAdmin(tx, admin.id)
      const { rows } = await tx.query(`select * from public.get_team_members($1)`, [top.id])
      expect(rows).toHaveLength(2)
    })
  })

  it('hands out the phone number, which is the point and the risk', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, first } = await chain(tx)
      await tx.query(`update public.profiles set phone = '0551234567' where id = $1`, [first.id])

      const row = (await members(tx, top.id))[0]!
      expect(row.phone).toBe('0551234567')
    })
  })

  it('can retract the phone number without a deploy', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top, first } = await chain(tx)
      await tx.query(`update public.profiles set phone = '0551234567' where id = $1`, [first.id])

      await setConfig(tx, 'team_shows_member_phone', 'false')

      const row = (await members(tx, top.id))[0]!
      // The rest of the row survives — this hides one column, it does not
      // switch the screen off.
      expect(row.phone).toBeNull()
      expect(row.full_name).toBe('First Level')
    })
  })

  it('never returns the things that were never asked for', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { top } = await chain(tx)
      const row = (await members(tx, top.id))[0]!
      const columns = Object.keys(row)

      /* The list is exactly what the brief asked for. Anything else showing up
         here — an email, a payout destination, a fraud score, a flag — would
         be a policy change smuggled in as a schema change, and the Privacy
         Policy tells users in so many words that these do not travel. */
      expect(columns.sort()).toEqual(
        [
          'avatar_path',
          'extra_plans',
          'full_name',
          'joined_at',
          'member_id',
          'member_level',
          'phone',
          'plans_bought',
          'plans_value',
          'redeemed',
          'remaining',
          'top_plan',
        ].sort(),
      )
    })
  })
})
