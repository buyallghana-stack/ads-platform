import { describe, expect, it } from 'vitest'

import {
  balanceOf,
  createUser,
  HAS_DB,
  pinLadder,
  setConfig,
  type TestUser,
  type Tx,
  withRollback,
} from '../support/db'

/**
 * Buying a plan settles the free trial days you never got to use.
 *
 * Operator, 2026-09-19: signing up buys 21 days of free earning, and upgrading
 * ends them early. What is lost is the days, not the points, because
 * `credit_points` only blocks NEW free earning and never touches the balance.
 *
 * THE HALF THAT IS DELIBERATELY NOT PAID. A day somebody was signed up for and
 * chose not to watch is their own loss. Only the days still ahead of them are
 * bought out, so the settlement depends on the calendar and not on how
 * diligent they were, and the tests below prove exactly that by paying two
 * users the same amount for very different behaviour.
 */

const FREE_PER_DAY = 100 // 1 ad a day at x1, with base_ad_points at 100

/**
 * Somebody who joined `days` ago and is about to buy.
 *
 * ⚠️ BOTH TABLES, and the second is the one that counts. `createUser`'s
 * `joinedDaysAgo` moves `auth.users.created_at`, but `handle_new_user` stamps
 * `public.profiles.created_at` with `now()`, and everything that asks how old
 * an account is reads the PROFILE: the free window in `credit_points`,
 * `get_user_earning_status`, and this buyout. Backdating only the auth row
 * produces an account the platform still considers brand new, so every case
 * below would have quietly measured a full 21 unused days.
 *
 * Fixing it inside `createUser` would close the free window for every fixture
 * user in the suite, since the default there is 90 days ago, so it is done
 * here. `free-window-minimum-and-fee.test.ts` carries the same local fix for
 * the same reason.
 */
const joined = async (tx: Tx, days: number) => {
  const user = await createUser(tx, { joinedDaysAgo: days })
  await tx.query(
    `update public.profiles set created_at = now() - make_interval(days => $2::int) where id = $1`,
    [user.id, days],
  )
  return user
}

/** Buys a plan the way the checkout does, and returns the payment id. */
const buy = async (tx: Tx, user: TestUser, slug = 'bronze') => {
  const { rows: tier } = await tx.query<{ id: string; price_minor: string }>(
    `select id, price_minor::text from public.tiers where slug = $1`,
    [slug],
  )
  const { rows } = await tx.query<{ id: string }>(
    `select * from public.start_subscription_payment($1, $2, 'paystack', $3::bigint)`,
    [user.id, tier[0]!.id, Number(tier[0]!.price_minor)],
  )
  await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
    rows[0]!.id,
    `TEST-${rows[0]!.id}`,
  ])
  return rows[0]!.id
}

const buyout = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ days_unused: number; points: string }>(
    `select days_unused, points::text from public.free_window_buyouts where user_id = $1`,
    [userId],
  )
  return rows[0] ? { days: rows[0].days_unused, points: Number(rows[0].points) } : null
}

const ledgerRows = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ amount: string; entry_type: string }>(
    `select amount::text, entry_type from public.points_ledger
      where user_id = $1 and entry_type = 'free_window_buyout' order by created_at`,
    [userId],
  )
  return rows.map((r) => ({ entryType: r.entry_type, amount: Number(r.amount) }))
}

describe.skipIf(!HAS_DB)('the free days you never got to use', () => {
  it("pays the operator's own worked example: day 8 of 21 leaves 13", async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 8)

      await buy(tx, user)

      expect(await buyout(tx, user.id)).toEqual({ days: 13, points: 13 * FREE_PER_DAY })
      expect(await balanceOf(tx, user.id)).toBe(1300)
    })
  })

  it('pays the whole window to somebody who buys the day they join', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 0)

      await buy(tx, user)

      expect(await buyout(tx, user.id)).toEqual({ days: 21, points: 2100 })
    })
  })

  it('pays nothing once the free window has already run out', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 30)

      await buy(tx, user)

      expect(await buyout(tx, user.id)).toBeNull()
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('does not care whether they watched: a missed day is their own loss', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')

      /* Two accounts, the same age, one of which has been credited for free
         watching and one of which has not. The settlement is the calendar, so
         the diligent one keeps their earnings AND gets the same buyout. That
         is the operator's rule: "failure to watch an ad is not redeemable so
         that is a loss to him". */
      const watcher = await joined(tx, 5)
      const idler = await joined(tx, 5)
      await tx.query(
        `select public.credit_points($1, 300, 'ad_view', 'test', 'watched-three', '{}'::jsonb, false)`,
        [watcher.id],
      )

      await buy(tx, watcher)
      await buy(tx, idler)

      expect(await buyout(tx, watcher.id)).toEqual(await buyout(tx, idler.id))
      expect(await buyout(tx, idler.id)).toEqual({ days: 16, points: 1600 })

      // The watcher is ahead by exactly what they actually earned, and no more.
      expect(await balanceOf(tx, watcher.id)).toBe(300 + 1600)
      expect(await balanceOf(tx, idler.id)).toBe(1600)
    })
  })

  it('is paid once, however many plans they buy after it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 4)

      await buy(tx, user, 'bronze')
      const afterFirst = await balanceOf(tx, user.id)
      await buy(tx, user, 'silver')
      await buy(tx, user, 'gold')

      expect(afterFirst).toBe(1700)
      expect(await balanceOf(tx, user.id)).toBe(1700)
      expect(await ledgerRows(tx, user.id)).toHaveLength(1)
    })
  })

  it('reads it back in the statement as its own thing, not an adjustment', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 1)

      await buy(tx, user)

      /* ⚠️ The kind matters as much as the amount. An entry type with no
         mapping falls through to `admin_adjustment` on the dashboard and tells
         the user their settlement was an "Account correction". That has been
         shipped four times already, for surveys, gift codes, game prizes and
         task rewards. */
      expect(await ledgerRows(tx, user.id)).toEqual([
        { entryType: 'free_window_buyout', amount: 2000 },
      ])
    })
  })

  it('does not spend the daily ad allowance they just paid for', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 2)

      await buy(tx, user)

      const { rows } = await tx.query<{ ads_completed: number }>(
        `select ads_completed from public.daily_earning_counters
          where user_id = $1 and day = public.utc_today()`,
        [user.id],
      )
      expect(rows[0]?.ads_completed ?? 0).toBe(0)
    })
  })

  it('is taken back when the payment is reversed', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 6)

      const paymentId = await buy(tx, user)
      expect(await balanceOf(tx, user.id)).toBe(1500)

      await tx.query(`select public.reverse_subscription_payment($1, 'test reversal')`, [paymentId])

      expect(await balanceOf(tx, user.id)).toBe(0)
      expect(await buyout(tx, user.id)).toBeNull()
      expect(await ledgerRows(tx, user.id)).toEqual([
        { entryType: 'free_window_buyout', amount: 1500 },
        { entryType: 'free_window_buyout', amount: -1500 },
      ])
    })
  })

  it('can be settled again on a genuine later purchase, from that later date', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 6)

      const first = await buy(tx, user)
      await tx.query(`select public.reverse_subscription_payment($1, 'test reversal')`, [first])

      /* The deleted row is why this works. Leaving it behind would bar an
         account whose first payment was reversed from ever being settled. */
      await buy(tx, user, 'silver')

      expect(await buyout(tx, user.id)).toEqual({ days: 15, points: 1500 })
    })
  })

  it('pays nothing at all while the switch is off', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '21')
      await setConfig(tx, 'free_window_buyout_enabled', 'false')
      const user = await joined(tx, 3)

      await buy(tx, user)

      expect(await buyout(tx, user.id)).toBeNull()
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('follows the free window if the operator retunes it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'free_earning_days', '30')
      await setConfig(tx, 'free_window_buyout_enabled', 'true')
      const user = await joined(tx, 8)

      await buy(tx, user)

      expect(await buyout(tx, user.id)).toEqual({ days: 22, points: 2200 })
    })
  })
})
