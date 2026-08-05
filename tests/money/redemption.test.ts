import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  balanceOf,
  createAdmin,
  createUser,
  creditPoints,
  expectRejection,
  pinEconomy,
  givePayoutDetails,
  redemption,
  setConfig,
  withRollback,
  type Tx,
} from '../support/db'

/**
 * The redemption pipeline — the path money actually leaves by.
 *
 * These are the tests §8 calls a release blocker, and until now every one of
 * them had been run by hand exactly once, by me, in a session that has since
 * ended. Nothing protected them from the next change.
 *
 * The figures are deliberately ordinary for this market: a user earns
 * 20,000 points (GHS 20 at the 1,000-points-to-the-cedi peg), cashes out
 * 12,000 of them (GHS 12), and keeps 8,000. They are small enough to read at
 * a glance and large enough to clear the platform's 5,000-point minimum, so a
 * test failing on the minimum is failing for the reason it says.
 */

const POINTS_EARNED = 20_000
const POINTS_REQUESTED = 12_000
const POINTS_LEFT = POINTS_EARNED - POINTS_REQUESTED

/** A user with money, details on file, and a redemption already requested. */
async function requestedRedemption(tx: Tx) {
  const user = await createUser(tx)
  const admin = await createAdmin(tx)
  await givePayoutDetails(tx, user.id)
  await creditPoints(tx, user.id, POINTS_EARNED)

  /*
    THE FEE IS PINNED, and every cedi figure in this file depends on it.

    These tests run against the SHARED project, so `redemption_fee_percent` is
    whatever the operator has it set to — they put it to 10% on 2026-08-01,
    hours after it shipped, and this file's GHS 12 quietly became GHS 10.80.
    That is the fee working, not a regression, but a test that inherits a live
    money setting is a test that fails on a day nobody touched the code.

    Anything asserting an AMOUNT must set the keys it depends on — which is
    what `pinEconomy` at the top of each test does, the fee and the peg
    together. The fee's own behaviour is proved in
    free-window-minimum-and-fee.test.ts, which sets it deliberately.
  */

  /* `select * from f(...)`, NEVER `select (f(...)).*`.
     Postgres expands the second form by calling the function once PER OUTPUT
     COLUMN — six times for this return type, which would quietly create six
     redemptions and six debits and make every balance assertion below wrong
     in a way that looks like a pipeline bug. */
  const { rows } = await tx.query<{ redemption_id: string }>(
    `select * from public.request_redemption($1, 'mobile_money', $2)`,
    [user.id, POINTS_REQUESTED],
  )

  return { user, admin, id: rows[0]!.redemption_id }
}

/** Moves a request past its fraud-catch window, the way the sweep does. */
async function matureTheHold(tx: Tx, id: string) {
  await tx.query(
    `update public.redemptions set holding_until = now() - interval '1 hour' where id = $1`,
    [id],
  )
  await tx.query(`select public.release_matured_holds()`)
}

describe('the harness itself', () => {
  it('has a database to talk to', () => {
    expect(
      HAS_DB,
      'SUPABASE_DB_URL is not set, so the money-critical tests did not run. ' +
        'They are the ones that protect the payout pipeline — a green run without ' +
        'them means nothing. See tests/README.md.',
    ).toBe(true)
  })
})

describe.skipIf(!HAS_DB)('requesting a payout', () => {
  it('debits the points immediately, not at approval', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, id } = await requestedRedemption(tx)

      // The whole reason the debit happens here: a user with 20,000 points
      // must not be able to have two 12,000-point requests in flight.
      expect(await balanceOf(tx, user.id)).toBe(POINTS_LEFT)

      const r = await redemption(tx, id)
      expect(r.status).toBe('held')
      expect(Number(r.points_amount)).toBe(POINTS_REQUESTED)
      expect(Number(r.currency_amount)).toBe(12)
    })
  })

  it('writes exactly one debit to the ledger, and the ledger agrees with the balance', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user } = await requestedRedemption(tx)

      const { rows } = await tx.query<{ entry_type: string; amount: string; balance_after: string }>(
        `select entry_type, amount, balance_after from public.points_ledger
          where user_id = $1 order by id`,
        [user.id],
      )

      expect(rows.map((r) => r.entry_type)).toEqual(['ad_view', 'redemption_request'])
      expect(Number(rows[1]!.amount)).toBe(-POINTS_REQUESTED)
      expect(Number(rows[1]!.balance_after)).toBe(POINTS_LEFT)

      const { rows: check } = await tx.query<{ drift: string }>(
        `select drift from public.reconcile_user_balance($1)`,
        [user.id],
      )
      expect(Number(check[0]!.drift)).toBe(0)
    })
  })

  it('refuses a second request the balance cannot cover', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user } = await requestedRedemption(tx)

      // 8,000 left, another 12,000 asked for. If this ever succeeds the
      // platform owes more than the user ever earned.
      const message = await expectRejection(tx, () =>
        tx.query(`select public.request_redemption($1, 'mobile_money', $2)`, [
          user.id,
          POINTS_REQUESTED,
        ]),
      )
      expect(message).toMatch(/insufficient/i)
      expect(await balanceOf(tx, user.id)).toBe(POINTS_LEFT)
    })
  })

  it('refuses an amount below the platform minimum', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx)
      await givePayoutDetails(tx, user.id)
      await creditPoints(tx, user.id, POINTS_EARNED)

      /* `redemption_minimum_points`, and no longer the tier's own column:
         since 2026-08-01 one number covers every plan. The wording moved with
         it — "the tier minimum" was a sentence about a rule that no longer
         exists. See tests/money/free-window-minimum-and-fee.test.ts. */
      const message = await expectRejection(tx, () =>
        tx.query(`select public.request_redemption($1, 'mobile_money', 4000)`, [user.id]),
      )
      expect(message).toMatch(/smallest withdrawal is 5000 points/i)
      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })

  it('refuses a disabled account, without taking its points', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx)
      await givePayoutDetails(tx, user.id)
      await creditPoints(tx, user.id, POINTS_EARNED)
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [user.id])

      await expectRejection(tx, () =>
        tx.query(`select public.request_redemption($1, 'mobile_money', $2)`, [
          user.id,
          POINTS_REQUESTED,
        ]),
      )
      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })

  it('honours the cool-off after payout details change', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx)
      await givePayoutDetails(tx, user.id)
      await creditPoints(tx, user.id, POINTS_EARNED)

      // Undo the fixture's backdating: details changed just now, which is the
      // account-takeover pattern the cool-off exists to slow down.
      await tx.query(
        `update public.user_payout_details set last_changed_at = now() where user_id = $1`,
        [user.id],
      )

      const message = await expectRejection(tx, () =>
        tx.query(`select public.request_redemption($1, 'mobile_money', $2)`, [
          user.id,
          POINTS_REQUESTED,
        ]),
      )
      expect(message).toMatch(/changed recently/i)
    })
  })
})

describe.skipIf(!HAS_DB)('the holding period', () => {
  it('will not approve a request still inside it', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'approve')`, [admin.id, id]),
      )
      expect(message).toMatch(/holding period/i)
      expect((await redemption(tx, id)).status).toBe('held')
    })
  })

  it('releases a matured request into the review queue', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)

      expect((await redemption(tx, id)).status).toBe('pending_approval')
    })
  })

  it('records an early approval as early, with its reason and an alert', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)

      await tx.query(
        `select public.admin_decide_redemption($1, $2, 'approve', null, null, true, $3)`,
        [admin.id, id, 'Verified by phone with the user'],
      )

      const r = await redemption(tx, id)
      expect(r.status).toBe('approved')
      expect(r.approved_early).toBe(true)
      expect(r.early_approval_reason).toBe('Verified by phone with the user')

      // Overriding a fraud control has to be visible somewhere an operator
      // looks, not only in a row nobody reads until something goes wrong.
      const { rows } = await tx.query<{ count: string }>(
        `select count(*) from public.system_alerts
          where code = 'redemption_approved_early'
            and context ->> 'redemption_id' = $1`,
        [id],
      )
      expect(Number(rows[0]!.count)).toBe(1)
    })
  })

  it('refuses an early approval with no reason', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'approve', null, null, true, null)`, [
          admin.id,
          id,
        ]),
      )
      expect(message).toMatch(/reason/i)
    })
  })
})

describe.skipIf(!HAS_DB)('an operator holding a request', () => {
  it('holds it, and the maturity sweep does not undo that', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)

      await tx.query(`select public.admin_decide_redemption($1, $2, 'hold', $3)`, [
        admin.id,
        id,
        'Confirm the MoMo name matches the profile',
      ])

      const held = await redemption(tx, id)
      expect(held.status).toBe('held')
      expect(held.admin_hold_at).not.toBeNull()

      // THE REGRESSION THIS FILE EXISTS FOR. `held` already meant "inside the
      // fraud window", and the sweep moves every matured held row back into
      // the queue. An operator hold placed on an already-matured request has
      // a holding_until in the past by definition, so without the infinity
      // park the operator's decision is silently reversed within the minute.
      await tx.query(`select public.release_matured_holds()`)
      expect((await redemption(tx, id)).status).toBe('held')
    })
  })

  it('requires a reason', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'hold', $3)`, [admin.id, id, 'no']),
      )
      expect(message).toMatch(/reason/i)
    })
  })

  it('returns the request by itself when a timed hold is configured', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await setConfig(tx, 'admin_hold_auto_return_hours', '24')

      await tx.query(`select public.admin_decide_redemption($1, $2, 'hold', $3)`, [
        admin.id,
        id,
        'Waiting on an ID photo',
      ])
      const held = await redemption(tx, id)
      expect(held.status).toBe('held')
      expect(held.holding_until.toISOString()).not.toBe('infinity')

      // Once the configured window elapses the existing sweep picks it up —
      // no second code path for admin holds.
      await matureTheHold(tx, id)
      expect((await redemption(tx, id)).status).toBe('pending_approval')
    })
  })
})

describe.skipIf(!HAS_DB)('refunds', () => {
  it('gives every point back when a request is declined', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)

      await tx.query(`select public.admin_decide_redemption($1, $2, 'decline', $3)`, [
        admin.id,
        id,
        'Payout account belongs to someone else',
      ])

      expect((await redemption(tx, id)).status).toBe('rejected')
      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })

  it('gives every point back when the user cancels during the hold', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, id } = await requestedRedemption(tx)

      await tx.query(`select public.cancel_redemption($1, $2)`, [user.id, id])

      expect((await redemption(tx, id)).status).toBe('cancelled')
      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })

  it('gives every point back when a disbursement fails', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await tx.query(`select public.admin_decide_redemption($1, $2, 'approve')`, [admin.id, id])

      await tx.query(`select public.mark_redemption_failed($1, $2, 'Wrong network selected')`, [
        admin.id,
        id,
      ])

      // Neither their points nor their money is the worst available outcome.
      expect((await redemption(tx, id)).status).toBe('failed')
      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })

  it('cannot be made to refund twice', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await tx.query(`select public.admin_decide_redemption($1, $2, 'decline', $3)`, [
        admin.id,
        id,
        'Payout account belongs to someone else',
      ])

      // Declining an already-declined request is the cheapest way to mint
      // points that exists, so it has to be refused by status, not by luck.
      await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'decline', $3)`, [
          admin.id,
          id,
          'Trying again',
        ]),
      )
      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })

  it('still works while earning is paused platform-wide', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await setConfig(tx, 'earning_paused_globally', 'true')

      // Migration 051. The §6.6 emergency switch stops the platform issuing
      // points; it must not strand points already taken for a request that is
      // now being refused. Before the fix both this and the user's own cancel
      // raised "Earning is paused platform-wide".
      await tx.query(`select public.admin_decide_redemption($1, $2, 'decline', $3)`, [
        admin.id,
        id,
        'Declined during a platform pause',
      ])

      expect((await redemption(tx, id)).status).toBe('rejected')
      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })

  it('lets a user cancel while earning is paused platform-wide', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, id } = await requestedRedemption(tx)
      await setConfig(tx, 'earning_paused_globally', 'true')

      await tx.query(`select public.cancel_redemption($1, $2)`, [user.id, id])

      expect((await redemption(tx, id)).status).toBe('cancelled')
      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })

  it('reaches a disabled account — disabling must not confiscate points', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [user.id])

      await tx.query(`select public.admin_decide_redemption($1, $2, 'decline', $3)`, [
        admin.id,
        id,
        'Account disabled pending review',
      ])

      expect(await balanceOf(tx, user.id)).toBe(POINTS_EARNED)
    })
  })
})

describe.skipIf(!HAS_DB)('the licence kill switch', () => {
  it('refuses to mark anything paid while payouts are disabled', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await tx.query(`select public.admin_decide_redemption($1, $2, 'approve')`, [admin.id, id])

      // This is the switch standing between a half-built disbursement path
      // and real money moving without a money-service licence.
      await setConfig(tx, 'payouts_enabled', 'false')
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'mark_paid', null, 'MOMO-1')`, [
          admin.id,
          id,
        ]),
      )
      expect(message).toMatch(/payouts are disabled/i)
      expect((await redemption(tx, id)).status).toBe('approved')
    })
  })

  it('marks it paid, with its reference, once payouts are enabled', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await tx.query(`select public.admin_decide_redemption($1, $2, 'approve')`, [admin.id, id])
      await setConfig(tx, 'payouts_enabled', 'true')

      await tx.query(`select public.admin_decide_redemption($1, $2, 'mark_paid', null, $3)`, [
        admin.id,
        id,
        'MOMO-12345',
      ])

      const r = await redemption(tx, id)
      expect(r.status).toBe('paid')
      expect(r.external_reference).toBe('MOMO-12345')
      expect(r.paid_at).not.toBeNull()
    })
  })

  it('will not pay a request that was never approved', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await setConfig(tx, 'payouts_enabled', 'true')

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'mark_paid', null, 'MOMO-1')`, [
          admin.id,
          id,
        ]),
      )
      expect(message).toMatch(/approved/i)
    })
  })
})

describe.skipIf(!HAS_DB)('a paid payout is the end of the line', () => {
  /** Takes a request all the way to paid. */
  async function paidRedemption(tx: Tx) {
    const made = await requestedRedemption(tx)
    await matureTheHold(tx, made.id)
    await tx.query(`select public.admin_decide_redemption($1, $2, 'approve')`, [
      made.admin.id,
      made.id,
    ])
    await setConfig(tx, 'payouts_enabled', 'true')
    await tx.query(`select public.admin_decide_redemption($1, $2, 'mark_paid', null, 'MOMO-1')`, [
      made.admin.id,
      made.id,
    ])
    return made
  }

  /*
    Disputes were removed on 2026-07-29 (migration 057). The operator holds a
    request before the money leaves instead — the user is told why and it can
    be undone, where `disputed` was terminal with no path out.

    These replace the three dispute tests rather than deleting them, because
    the thing worth asserting did not go away: a payout that has been sent
    must not be movable by anybody, and the removed verb must be refused
    rather than silently ignored by an old client that still sends it.
  */
  it('refuses the removed dispute verb outright', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await paidRedemption(tx)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'dispute', $3)`, [
          admin.id,
          id,
          'Recipient says the money never arrived',
        ]),
      )
      expect(message).toMatch(/unknown payout action/i)
      expect((await redemption(tx, id)).status).toBe('paid')
    })
  })

  it('cannot be put back into any other state', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, admin, id } = await paidRedemption(tx)
      const before = await balanceOf(tx, user.id)

      for (const action of ['approve', 'hold', 'decline']) {
        await expectRejection(tx, () =>
          tx.query(`select public.admin_decide_redemption($1, $2, $3, 'anything')`, [
            admin.id,
            id,
            action,
          ]),
        )
      }

      expect((await redemption(tx, id)).status).toBe('paid')
      // And nothing moved the points while all that was being refused.
      expect(await balanceOf(tx, user.id)).toBe(before)
    })
  })

  it('cannot be written into the disputed state directly', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { id } = await paidRedemption(tx)

      // The enum label still exists — Postgres cannot drop a value from a
      // type without rebuilding it — so the check constraint is what actually
      // makes it unreachable. Assert the constraint, not the absence.
      const message = await expectRejection(tx, () =>
        tx.query(`update public.redemptions set status = 'disputed' where id = $1`, [id]),
      )
      expect(message).toMatch(/redemptions_no_disputes|violates check constraint/i)
    })
  })
})

describe.skipIf(!HAS_DB)('who is allowed to decide', () => {
  it('refuses a decision from an account that is not an administrator', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)

      // The server action names the acting admin from the verified session,
      // so this is the database refusing to take that on trust anyway.
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'approve')`, [user.id, id]),
      )
      expect(message).toMatch(/not an administrator/i)
      expect((await redemption(tx, id)).status).toBe('pending_approval')
    })
  })

  it('refuses an action it does not recognise', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { admin, id } = await requestedRedemption(tx)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_decide_redemption($1, $2, 'delete_and_keep_the_money')`, [
          admin.id,
          id,
        ]),
      )
      expect(message).toMatch(/unknown payout action/i)
    })
  })
})

describe.skipIf(!HAS_DB)('the admin queue listing', () => {
  it('reports the destination whole, the reuse count, and what was paid before', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const shared = '0244555666'

      const first = await createUser(tx, { name: 'First Earner' })
      await givePayoutDetails(tx, first.id, { msisdn: shared, accountName: 'First Earner' })
      await creditPoints(tx, first.id, POINTS_EARNED)
      await tx.query(`select public.request_redemption($1, 'mobile_money', $2)`, [
        first.id,
        POINTS_REQUESTED,
      ])

      // A second account cashing out to the same number is the cheapest fraud
      // signal this platform has, and the one the queue must not make an
      // operator go looking for.
      const second = await createUser(tx, { name: 'Second Earner' })
      await givePayoutDetails(tx, second.id, { msisdn: shared, accountName: 'Second Earner' })
      await creditPoints(tx, second.id, POINTS_EARNED)
      await tx.query(`select public.request_redemption($1, 'mobile_money', $2)`, [
        second.id,
        POINTS_REQUESTED,
      ])

      const { rows } = await tx.query<{
        reference: string
        destination: string
        reuse: number
        paid_before: number
        provider: string
        user_name: string
      }>(
        `select reference, destination, reuse, paid_before, provider, user_name
           from public.admin_list_redemptions()
          where user_id in ($1, $2)`,
        [first.id, second.id],
      )

      expect(rows).toHaveLength(2)
      for (const row of rows) {
        // Whole, not pre-masked: masking in the data would make the reveal
        // impossible and the reuse count meaningless.
        expect(row.destination).toBe(shared)
        expect(row.reuse).toBe(1)
        expect(row.paid_before).toBe(0)
        expect(row.provider).toBe('MTN Mobile Money')
        expect(row.reference).toMatch(/^RDM-[0-9A-F]{6}$/)
      }
    })
  })

  it('counts a user’s previous payouts and their value', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const { user, admin, id } = await requestedRedemption(tx)
      await matureTheHold(tx, id)
      await tx.query(`select public.admin_decide_redemption($1, $2, 'approve')`, [admin.id, id])
      await setConfig(tx, 'payouts_enabled', 'true')
      await tx.query(`select public.admin_decide_redemption($1, $2, 'mark_paid', null, 'MOMO-1')`, [
        admin.id,
        id,
      ])

      // A second request from the same person should now show the first as
      // history — a returning payee reads very differently from a first one.
      await creditPoints(tx, user.id, POINTS_EARNED)
      const { rows: made } = await tx.query<{ redemption_id: string }>(
        `select * from public.request_redemption($1, 'mobile_money', $2)`,
        [user.id, POINTS_REQUESTED],
      )

      const { rows } = await tx.query<{ paid_before: number; paid_before_ghs: string }>(
        `select paid_before, paid_before_ghs from public.admin_list_redemptions() where id = $1`,
        [made[0]!.redemption_id],
      )

      expect(rows[0]!.paid_before).toBe(1)
      expect(Number(rows[0]!.paid_before_ghs)).toBe(12)
    })
  })

  it('refuses a caller who is not an administrator', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx)

      // Simulates a signed-in browser token: is_admin() is asked of the
      // caller, and a non-null non-admin caller is turned away.
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: user.id, role: 'authenticated' }),
      ])
      await tx.query(`set local role authenticated`)

      const message = await expectRejection(tx, () =>
        tx.query(`select * from public.admin_list_redemptions()`),
      )
      expect(message).toMatch(/not an administrator|permission denied/i)
    })
  })
})
