import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  actAs,
  createAdmin,
  createUser,
  expectRejection,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * The leaderboard.
 *
 * It moves no money, so the risk here is not a wrong balance — it is a wrong
 * ORDER, which is public, and a leak of who somebody is. Those are the two
 * things this file attacks:
 *
 *   - the ranking is right, including ties, exclusions and every period;
 *   - the board can be reached by a user and cannot be FARMED by one;
 *   - the abbreviated name is genuinely all a user can get, and the admin
 *     copy is genuinely unreachable from a user session.
 *
 * The farming test is the important one. A declined withdrawal returns as a
 * `redemption_refund` credit, so if refunds counted, anyone could request a
 * withdrawal, have it declined and bank the points on the board for free.
 */

/** Writes a counted credit at a chosen moment in time.
 *
 *  `credit_points` stamps `now()`, which is the transaction clock and
 *  therefore identical for every row a test writes — useless for a feature
 *  whose whole subject is which period a point landed in. The ledger is
 *  append-only but this is an INSERT, which the trigger permits, and the
 *  balance is not what is being tested. */
const creditAt = async (
  tx: Tx,
  userId: string,
  amount: number,
  /** A SQL expression, not a value — it is interpolated so that
   *  `date_trunc('week', now())` is evaluated by Postgres rather than sent as
   *  the literal string. Every caller is a constant written in this file. */
  atExpr: string,
  entryType = 'ad_view',
) => {
  await tx.query(
    `insert into public.points_ledger
       (user_id, entry_type, amount, balance_after, points_per_currency_unit, created_at)
     values ($1, $2::public.ledger_entry_type, $3::bigint, greatest($3::bigint, 0::bigint),
             public.config_int('points_per_currency_unit'), ${atExpr})`,
    [userId, entryType, amount],
  )
}

const board = async (tx: Tx, period = 'all') => {
  const { rows } = await tx.query(`select * from public.get_leaderboard($1, 100)`, [period])
  return rows as Array<{
    rank: string
    user_id: string
    display_name: string
    points: string
    previous_rank: string | null
    movement: string
  }>
}

const standing = async (tx: Tx, period = 'all') => {
  const { rows } = await tx.query(`select * from public.get_leaderboard_standing($1)`, [period])
  return rows[0] as
    | { rank: string; points: string; movement: string; total_ranked: string }
    | undefined
}

describe.skipIf(!HAS_DB)('leaderboard', () => {
  it('ranks by points, highest first', async () => {
    await withRollback(async (tx) => {
      const low = await createUser(tx, { name: 'Kofi Mensah' })
      const high = await createUser(tx, { name: 'Ama Boateng' })
      const mid = await createUser(tx, { name: 'Yaw Osei' })
      await creditAt(tx, low.id, 100, 'now()')
      await creditAt(tx, high.id, 900, 'now()')
      await creditAt(tx, mid.id, 500, 'now()')

      await actAs(tx, low.id)
      const rows = await board(tx)
      const mine = rows.filter((r) => [low.id, high.id, mid.id].includes(r.user_id))

      expect(mine.map((r) => r.user_id)).toEqual([high.id, mid.id, low.id])
      expect(mine.map((r) => Number(r.points))).toEqual([900, 500, 100])
    })
  })

  /* Competition ranking: two users on the same score share a place and the
     next one down is skipped. Silver-silver-bronze would be a lie about how
     many people beat you. */
  it('gives tied users the same rank and skips the next place', async () => {
    await withRollback(async (tx) => {
      const a = await createUser(tx, { name: 'Tied One' })
      const b = await createUser(tx, { name: 'Tied Two' })
      const c = await createUser(tx, { name: 'Third Place' })
      await creditAt(tx, a.id, 500, 'now()')
      await creditAt(tx, b.id, 500, 'now()')
      await creditAt(tx, c.id, 100, 'now()')

      await actAs(tx, a.id)
      const rows = await board(tx)
      const byId = new Map(rows.map((r) => [r.user_id, Number(r.rank)]))

      expect(byId.get(a.id)).toBe(byId.get(b.id))
      expect(byId.get(c.id)).toBe(byId.get(a.id)! + 2)
    })
  })

  /* THE FARMING TEST. If `redemption_refund` counted, this user would end the
     test 20,000 points up the board having earned 20,000 — and could repeat
     it at will, because requesting a withdrawal and having it declined costs
     nothing. */
  it('cannot be farmed by requesting a withdrawal and having it refunded', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Farmer Joe' })
      await creditAt(tx, user.id, 20_000, 'now()')

      await actAs(tx, user.id)
      const before = Number((await standing(tx))!.points)

      await creditAt(tx, user.id, -8_000, 'now()', 'redemption_request')
      await creditAt(tx, user.id, 8_000, 'now()', 'redemption_refund')

      expect(Number((await standing(tx))!.points)).toBe(before)
    })
  })

  it('leaves granted points in when the config says so, and out when it does not', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Gifted Person' })
      await creditAt(tx, user.id, 1_000, 'now()')
      await creditAt(tx, user.id, 5_000, 'now()', 'gift_code')
      await creditAt(tx, user.id, 500, 'now()', 'admin_adjustment')
      await actAs(tx, user.id)

      // The operator's choice, 2026-07-30: everything counts.
      expect(Number((await standing(tx))!.points)).toBe(6_500)

      await setConfig(tx, 'leaderboard_counts_granted_points', 'false')
      expect(Number((await standing(tx))!.points)).toBe(1_000)
    })
  })

  /* A claw-back has to be able to take a place back. Summing only positive
     adjustments would leave the board crediting points that were removed. */
  it('lets a negative admin adjustment pull a standing back down', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Clawed Back' })
      await creditAt(tx, user.id, 4_000, 'now()')
      await creditAt(tx, user.id, -1_500, 'now()', 'admin_adjustment')

      await actAs(tx, user.id)
      expect(Number((await standing(tx))!.points)).toBe(2_500)
    })
  })

  it('counts only the points earned inside each period', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Period Person' })
      await creditAt(tx, user.id, 7, "date_trunc('day', now()) + interval '1 second'")
      await creditAt(tx, user.id, 70, "date_trunc('week', now()) + interval '1 second'")
      await creditAt(tx, user.id, 700, "date_trunc('month', now()) + interval '1 second'")
      await creditAt(tx, user.id, 7_000, "date_trunc('year', now()) - interval '5 days'")
      await actAs(tx, user.id)

      const day = Number((await standing(tx, 'day'))!.points)
      const week = Number((await standing(tx, 'week'))!.points)
      const month = Number((await standing(tx, 'month'))!.points)
      const all = Number((await standing(tx, 'all'))!.points)

      // Each window contains the ones inside it, so the totals only grow.
      expect(day).toBeGreaterThanOrEqual(7)
      expect(week).toBeGreaterThanOrEqual(day)
      expect(month).toBeGreaterThanOrEqual(week)
      expect(all).toBe(7_777)
      // The oldest credit is outside every calendar period but all-time.
      expect(month).toBeLessThan(all)
    })
  })

  /* Movement is derived, not stored, so the test that matters is that the
     comparison window is really the PREVIOUS period rather than the current
     one. Last week this user was behind; this week they are ahead. */
  it('reports the arrow against where the user stood last period', async () => {
    await withRollback(async (tx) => {
      const climber = await createUser(tx, { name: 'Climbing Up' })
      const faller = await createUser(tx, { name: 'Sliding Down' })

      const lastWeek = "date_trunc('week', now()) - interval '3 days'"
      const thisWeek = "date_trunc('week', now()) + interval '1 second'"

      await creditAt(tx, climber.id, 100, lastWeek)
      await creditAt(tx, faller.id, 900, lastWeek)
      await creditAt(tx, climber.id, 900, thisWeek)
      await creditAt(tx, faller.id, 100, thisWeek)

      await actAs(tx, climber.id)
      const rows = await board(tx, 'week')
      const up = rows.find((r) => r.user_id === climber.id)!
      const down = rows.find((r) => r.user_id === faller.id)!

      expect(Number(up.rank)).toBeLessThan(Number(down.rank))
      expect(up.movement).toBe('up')
      expect(down.movement).toBe('down')
    })
  })

  it('marks somebody with no previous standing as new', async () => {
    await withRollback(async (tx) => {
      const fresh = await createUser(tx, { name: 'Brand New' })
      await creditAt(tx, fresh.id, 250, "date_trunc('week', now()) + interval '1 second'")

      await actAs(tx, fresh.id)
      const row = (await board(tx, 'week')).find((r) => r.user_id === fresh.id)!
      expect(row.movement).toBe('new')
      expect(row.previous_rank).toBeNull()
    })
  })

  it('shows other users an abbreviated name and never the full one', async () => {
    await withRollback(async (tx) => {
      const watcher = await createUser(tx, { name: 'Nosy Neighbour' })
      const subject = await createUser(tx, { name: 'Kwame Asante' })
      await creditAt(tx, subject.id, 5_000, 'now()')
      await creditAt(tx, watcher.id, 10, 'now()')

      await actAs(tx, watcher.id)
      const row = (await board(tx)).find((r) => r.user_id === subject.id)!

      expect(row.display_name).toBe('Kwame A.')
      // Not merely "abbreviated somewhere" — the surname is nowhere in the row.
      expect(JSON.stringify(row)).not.toContain('Asante')
    })
  })

  it('leaves out disabled and deleted accounts', async () => {
    await withRollback(async (tx) => {
      const viewer = await createUser(tx, { name: 'Still Here' })
      const banned = await createUser(tx, { name: 'Banned Person' })
      const gone = await createUser(tx, { name: 'Deleted user' })
      await creditAt(tx, viewer.id, 10, 'now()')
      await creditAt(tx, banned.id, 90_000, 'now()')
      await creditAt(tx, gone.id, 80_000, 'now()')
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [banned.id])
      await tx.query(`update public.profiles set deleted_at = now() where id = $1`, [gone.id])

      await actAs(tx, viewer.id)
      const ids = (await board(tx)).map((r) => r.user_id)

      expect(ids).not.toContain(banned.id)
      expect(ids).not.toContain(gone.id)
      expect(ids).toContain(viewer.id)
    })
  })

  it('leaves out anyone who has earned nothing in the period', async () => {
    await withRollback(async (tx) => {
      const earner = await createUser(tx, { name: 'Has Points' })
      const idle = await createUser(tx, { name: 'No Points' })
      await creditAt(tx, earner.id, 10, 'now()')

      await actAs(tx, idle.id)
      expect((await board(tx)).map((r) => r.user_id)).not.toContain(idle.id)
      // And their own standing is simply absent rather than a zeroth place.
      expect(await standing(tx)).toBeUndefined()
    })
  })

  it('reports a standing to a user far outside the visible ranks', async () => {
    await withRollback(async (tx) => {
      const me = await createUser(tx, { name: 'Way Down' })
      await creditAt(tx, me.id, 1, 'now()')
      for (let i = 0; i < 4; i++) {
        const other = await createUser(tx, { name: `Above Me${i}` })
        await creditAt(tx, other.id, 1_000 + i, 'now()')
      }

      await actAs(tx, me.id)
      const { rows } = await tx.query(`select * from public.get_leaderboard('all', 3)`)
      expect(rows).toHaveLength(3)
      expect(rows.map((r) => r.user_id)).not.toContain(me.id)

      // The pinned row still knows exactly where they are.
      const mine = (await standing(tx))!
      expect(Number(mine.rank)).toBeGreaterThan(3)
      expect(Number(mine.total_ranked)).toBeGreaterThanOrEqual(5)
    })
  })

  it('refuses the board to a caller with no session', async () => {
    await withRollback(async (tx) => {
      // No actAs: auth.uid() is null, which is what a service-client call or
      // an unauthenticated request looks like.
      expect(
        await expectRejection(tx, () => tx.query(`select * from public.get_leaderboard('all', 10)`)),
      ).toMatch(/signed in/i)
      expect(
        await expectRejection(tx, () =>
          tx.query(`select * from public.get_leaderboard_standing('all')`),
        ),
      ).toMatch(/signed in/i)
    })
  })

  it('gives the admin copy the person behind the rank', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Kwame Asante' })
      await creditAt(tx, user.id, 6_000, 'now()')

      const { rows } = await tx.query(
        `select * from public.admin_get_leaderboard($1, 'all', 100)`,
        [admin.id],
      )
      const row = rows.find((r) => r.user_id === user.id)!

      expect(row.full_name).toBe('Kwame Asante')
      expect(row.display_name).toBe('Kwame A.')
      expect(row.email).toBe(user.email)
      expect(row.phone).toBeDefined()

      // The rank is the same number the users are looking at, not a second
      // opinion computed a different way.
      await actAs(tx, user.id)
      const publicRow = (await board(tx)).find((r) => r.user_id === user.id)!
      expect(publicRow.rank).toBe(row.rank)
      expect(publicRow.points).toBe(row.points)
    })
  })

  it('refuses the admin copy to a normal user', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Not An Admin' })
      expect(
        await expectRejection(tx, () =>
          tx.query(`select * from public.admin_get_leaderboard($1, 'all', 10)`, [user.id]),
        ),
      ).toMatch(/admin/i)
    })
  })

  it('falls back to all-time rather than failing on an unknown period', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Odd Tab' })
      await creditAt(tx, user.id, 42, "date_trunc('year', now()) - interval '10 days'")
      await actAs(tx, user.id)

      // A tab value from a hand-edited URL must show a board, not an error.
      expect(Number((await standing(tx, 'fortnight'))!.points)).toBe(42)
    })
  })
})
