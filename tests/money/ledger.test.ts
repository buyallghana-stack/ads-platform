import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  balanceOf,
  createUser,
  creditPoints,
  expectRejection,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * The points ledger — the append-only centre everything else is derived from.
 *
 * `user_balances` exists for speed and is therefore the thing that can be
 * wrong. These tests care about one property above all others: the ledger and
 * the balance agree after every operation, and the ledger cannot be edited to
 * make them agree.
 */

describe.skipIf(!HAS_DB)('the append-only guarantee', () => {
  it('refuses an UPDATE, even from the owner', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await creditPoints(tx, user.id, 5_000)

      // RLS would not be enough here: the service key bypasses it entirely,
      // and this table has to resist a mistake in our own server code exactly
      // as firmly as a hostile client. Hence a trigger, which no role escapes.
      const message = await expectRejection(tx, () =>
        tx.query(`update public.points_ledger set amount = 999999 where user_id = $1`, [user.id]),
      )
      expect(message).toMatch(/append-only/i)
    })
  })

  it('refuses a DELETE', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await creditPoints(tx, user.id, 5_000)

      const message = await expectRejection(tx, () =>
        tx.query(`delete from public.points_ledger where user_id = $1`, [user.id]),
      )
      expect(message).toMatch(/append-only/i)
    })
  })

  it('refuses a zero-amount entry, so a no-op cannot look like a transaction', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)

      await expectRejection(tx, () => tx.query(`select public.credit_points($1, 0, 'ad_view')`, [user.id]))
      await expectRejection(tx, () => tx.query(`select public.debit_points($1, 0, 'ad_view')`, [user.id]))
    })
  })

  it('refuses a negative credit', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.credit_points($1, -5000, 'ad_view')`, [user.id]),
      )
      expect(message).toMatch(/positive/i)
    })
  })
})

describe.skipIf(!HAS_DB)('the running balance', () => {
  it('records balance_after on every entry, and it tracks the real balance', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)

      await creditPoints(tx, user.id, 5_000)
      await creditPoints(tx, user.id, 2_500)
      await tx.query(`select public.debit_points($1, 1_500, 'admin_adjustment')`, [user.id])

      const { rows } = await tx.query<{ amount: string; balance_after: string }>(
        `select amount, balance_after from public.points_ledger where user_id = $1 order by id`,
        [user.id],
      )

      // balance_after is redundant with the running sum on purpose: it makes
      // drift visible at the exact entry where it started, rather than only
      // in the total.
      expect(rows.map((r) => Number(r.balance_after))).toEqual([5_000, 7_500, 6_000])
      expect(await balanceOf(tx, user.id)).toBe(6_000)
    })
  })

  it('reconciles to zero drift', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await creditPoints(tx, user.id, 9_000)
      await tx.query(`select public.debit_points($1, 4_000, 'admin_adjustment')`, [user.id])

      const { rows } = await tx.query<{
        stored_balance: string
        ledger_balance: string
        drift: string
        entry_count: string
      }>(`select * from public.reconcile_user_balance($1)`, [user.id])

      expect(Number(rows[0]!.stored_balance)).toBe(5_000)
      expect(Number(rows[0]!.ledger_balance)).toBe(5_000)
      expect(Number(rows[0]!.drift)).toBe(0)
      expect(Number(rows[0]!.entry_count)).toBe(2)
    })
  })

  it('reports drift rather than silently repairing it', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await creditPoints(tx, user.id, 5_000)

      // Corrupt the cache directly — the one thing that CAN be wrong.
      await tx.query(`update public.user_balances set balance = 9_999 where user_id = $1`, [user.id])

      const { rows } = await tx.query<{ drift: string }>(
        `select drift from public.reconcile_user_balance($1)`,
        [user.id],
      )

      // A silent repair would hide the bug that caused the drift, so this
      // function reports and stops.
      expect(Number(rows[0]!.drift)).toBe(4_999)
      expect(await balanceOf(tx, user.id)).toBe(9_999)
    })
  })
})

describe.skipIf(!HAS_DB)('spending points', () => {
  it('refuses a debit larger than the balance', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await creditPoints(tx, user.id, 3_000)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.debit_points($1, 3_001, 'admin_adjustment')`, [user.id]),
      )
      expect(message).toMatch(/insufficient/i)

      // And nothing was written on the way to failing.
      expect(await balanceOf(tx, user.id)).toBe(3_000)
      const { rows } = await tx.query<{ count: string }>(
        `select count(*) from public.points_ledger where user_id = $1`,
        [user.id],
      )
      expect(Number(rows[0]!.count)).toBe(1)
    })
  })

  it('allows a debit of exactly the balance', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await creditPoints(tx, user.id, 3_000)

      await tx.query(`select public.debit_points($1, 3_000, 'admin_adjustment')`, [user.id])
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('refuses a debit from an account that has never earned', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)

      // No user_balances row at all. The UPDATE matches nothing, which must
      // raise rather than quietly do nothing and write a ledger entry.
      await expectRejection(tx, () =>
        tx.query(`select public.debit_points($1, 100, 'admin_adjustment')`, [user.id]),
      )
      const { rows } = await tx.query<{ count: string }>(
        `select count(*) from public.points_ledger where user_id = $1`,
        [user.id],
      )
      expect(Number(rows[0]!.count)).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('crediting the same source twice', () => {
  it('is refused when the entry carries a reference', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      const adId = '11111111-1111-1111-1111-111111111111'

      await tx.query(`select public.credit_points($1, 500, 'ad_view', 'ad', $2)`, [user.id, adId])

      // A double-submitted form, a retried request or a bug all look like
      // this, and all of them mint points if the index is not there.
      await expectRejection(tx, () =>
        tx.query(`select public.credit_points($1, 500, 'ad_view', 'ad', $2)`, [user.id, adId]),
      )
      expect(await balanceOf(tx, user.id)).toBe(500)
    })
  })

  it('is allowed for admin adjustments, which legitimately repeat', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      const ticket = 'SUPPORT-4821'

      await tx.query(`select public.credit_points($1, 250, 'admin_adjustment', 'ticket', $2)`, [
        user.id,
        ticket,
      ])
      await tx.query(`select public.credit_points($1, 250, 'admin_adjustment', 'ticket', $2)`, [
        user.id,
        ticket,
      ])

      expect(await balanceOf(tx, user.id)).toBe(500)
    })
  })
})

describe.skipIf(!HAS_DB)('the global earning switch', () => {
  it('stops every credit path at once when earning is paused', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await setConfig(tx, 'earning_paused_globally', 'true')

      // Checked inside credit_points rather than at each call site, so every
      // earning path is covered by construction rather than by remembering.
      const message = await expectRejection(tx, () => creditPoints(tx, user.id, 1_000))
      expect(message).toMatch(/paused/i)
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('does not block a refund — a paused platform still owes what it took', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await creditPoints(tx, user.id, 5_000)
      await tx.query(`select public.debit_points($1, 2_000, 'redemption_request')`, [user.id])
      await setConfig(tx, 'earning_paused_globally', 'true')

      // THE REGRESSION MIGRATION 051 FIXED. Every refund path goes through
      // credit_points, and the pause used to be checked before the entry type
      // was looked at. Flipping the emergency switch therefore froze every
      // redemption in flight: points already debited, and no way to return
      // them until somebody noticed. An emergency stop must not take users'
      // points hostage.
      await tx.query(
        `select public.credit_points($1, 2_000, 'redemption_refund', 'redemption', 'x')`,
        [user.id],
      )
      expect(await balanceOf(tx, user.id)).toBe(5_000)
    })
  })

  it('still blocks an admin adjustment while paused', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await setConfig(tx, 'earning_paused_globally', 'true')

      // Deliberately NOT exempted alongside refunds: an operator handing out
      // points during a platform-wide freeze is what the freeze is for.
      const message = await expectRejection(tx, () =>
        tx.query(`select public.credit_points($1, 1_000, 'admin_adjustment')`, [user.id]),
      )
      expect(message).toMatch(/paused/i)
    })
  })
})

describe.skipIf(!HAS_DB)('the daily cap', () => {
  it('stops a user at their tier cap', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)

      // Free tier allows 20 ads a day. Drive the counter to the cap directly
      // rather than crediting twenty times over the network.
      await tx.query(
        `insert into public.daily_earning_counters (user_id, day, ads_completed, points_earned)
         values ($1, public.utc_today(), 20, 20000)`,
        [user.id],
      )

      const message = await expectRejection(tx, () =>
        tx.query(`select public.credit_points($1, 500, 'ad_view', null, null, '{}'::jsonb, true)`, [
          user.id,
        ]),
      )
      expect(message).toMatch(/daily cap/i)
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('does not consume the cap for credits that are not ad views', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await tx.query(
        `insert into public.daily_earning_counters (user_id, day, ads_completed, points_earned)
         values ($1, public.utc_today(), 20, 20000)`,
        [user.id],
      )

      // A referral bonus is not an ad view and must not be refused because
      // the user watched their allowance today.
      await tx.query(`select public.credit_points($1, 1_000, 'referral_signup')`, [user.id])
      expect(await balanceOf(tx, user.id)).toBe(1_000)
    })
  })
})
