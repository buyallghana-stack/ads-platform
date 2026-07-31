import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createAdmin, createUser, withRollback } from '../support/db'

/**
 * Who an announcement reaches.
 *
 * THE RULE, from the operator on 2026-07-31: "if the user wasnt registered
 * before the announcement he must not receive it." That is how the code
 * already behaved — `broadcast_notification` writes one row per profile that
 * exists AT THE MOMENT IT RUNS, and nothing anywhere backfills a new account
 * with what it missed — but "already true" and "cannot quietly stop being
 * true" are different things, and only the second one survives somebody
 * deciding a welcome flow should catch new users up.
 *
 * The same guarantee has to hold for the OTHER broadcaster, which is easy to
 * forget: creating a plan tells everybody about it through the same function.
 */

const announcementsFor = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from public.notifications
      where user_id = $1 and type = 'announcement'`,
    [userId],
  )
  return rows[0]!.n
}

const broadcast = async (tx: Tx, adminId: string, title: string) =>
  tx.query(`select public.admin_broadcast_announcement($1, $2, $3)`, [
    adminId,
    title,
    'The body of the announcement, which is long enough to pass validation.',
  ])

describe.skipIf(!HAS_DB)('announcements — who receives one', () => {
  it('reaches the people who were there', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const early = await createUser(tx, { name: 'Already Here' })

      await broadcast(tx, admin.id, 'Something happened')

      expect(await announcementsFor(tx, early.id)).toBe(1)
    })
  })

  it('does NOT reach somebody who signed up afterwards', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const early = await createUser(tx, { name: 'Already Here' })

      await broadcast(tx, admin.id, 'Old news')

      // Joins after the fact. An announcement is a thing that was said at a
      // moment, not a notice pinned to the wall — somebody who arrives later
      // was not in the room.
      const late = await createUser(tx, { name: 'Arrived Later' })

      expect(await announcementsFor(tx, late.id)).toBe(0)
      expect(await announcementsFor(tx, early.id)).toBe(1)
    })
  })

  it('does not repeat itself to the people who did receive it', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const person = await createUser(tx, { name: 'Reader' })

      await broadcast(tx, admin.id, 'First')
      await broadcast(tx, admin.id, 'Second')

      // Two announcements, two rows — not two rows of the first one.
      expect(await announcementsFor(tx, person.id)).toBe(2)
      const { rows } = await tx.query<{ title: string }>(
        `select title from public.notifications
          where user_id = $1 and type = 'announcement' order by title`,
        [person.id],
      )
      /* Ordered by TITLE, not by created_at. Everything written inside one
         transaction shares a timestamp — `now()` is the transaction clock —
         so ordering these by when they arrived is a coin toss that passes
         locally and fails on the next run. */
      expect(rows.map((r) => r.title)).toEqual(['First', 'Second'])
    })
  })

  it('skips a disabled account', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const disabled = await createUser(tx, { name: 'Gone' })
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [disabled.id])

      await broadcast(tx, admin.id, 'Not for them')

      expect(await announcementsFor(tx, disabled.id)).toBe(0)
    })
  })

  it('records how many it actually reached', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await createUser(tx, { name: 'One' })
      await createUser(tx, { name: 'Two' })

      await broadcast(tx, admin.id, 'Counted')

      // The count is evidence of who was there, and it is what the admin
      // screen shows. A later signup must not change it retrospectively.
      const { rows } = await tx.query<{ recipient_count: number }>(
        `select recipient_count from public.announcements where title = 'Counted'`,
      )
      const atSendTime = rows[0]!.recipient_count
      await createUser(tx, { name: 'Three' })

      const { rows: after } = await tx.query<{ recipient_count: number }>(
        `select recipient_count from public.announcements where title = 'Counted'`,
      )
      expect(after[0]!.recipient_count).toBe(atSendTime)
    })
  })
})

describe.skipIf(!HAS_DB)('announcements — the other broadcaster', () => {
  it('tells everybody about a new plan, but only the people who exist', async () => {
    await withRollback(async (tx) => {
      const early = await createUser(tx, { name: 'Already Here' })

      // Creating a tier fires `notify_new_tier`, which goes through the same
      // fan-out. It is the broadcaster nobody remembers when they think about
      // announcements.
      await tx.query(
        `insert into public.tiers
           (slug, name, description, price_minor, billing_period_days, daily_ad_cap,
            reward_multiplier, redemption_minimum_points, referral_bonus_multiplier,
            sort_order, is_active)
         values ('test_tier_notify', 'Test Tier', 'A plan made by a test', 1000, 30, 10,
                 1.0, 5000, 1.0, 99, true)`,
      )

      const late = await createUser(tx, { name: 'Arrived Later' })

      expect(await announcementsFor(tx, early.id)).toBe(1)
      expect(await announcementsFor(tx, late.id)).toBe(0)
    })
  })
})
