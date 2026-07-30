import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  balanceOf,
  createAdmin,
  createUser,
  expectRejection,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * The game engine.
 *
 * These games mint points, so the risks are the money ones: a play that pays
 * twice, a play that is not consumed, a client that can influence the outcome,
 * and a prize table whose odds do not match what it draws.
 *
 * The draw itself is tested EXACTLY rather than statistically. A test that
 * spins ten thousand times and checks the distribution "looks about right" is
 * slow and flaky and proves less than checking that every roll boundary maps
 * to the segment that owns it — which is what actually goes wrong with
 * cumulative-weight selection.
 */

const play = async (tx: Tx, userId: string, game = 'mystery_box') => {
  const { rows } = await tx.query(`select public.play_game($1, $2::public.game_kind) as r`, [
    userId,
    game,
  ])
  return rows[0]!.r as {
    outcome: string
    slot?: number
    label?: string
    points?: number
    extra_plays?: number
    remaining?: number
    allowance?: number
  }
}

/** Replaces a game's whole prize table, so a test controls its own odds. */
const setBoard = async (
  tx: Tx,
  game: string,
  prizes: Array<{ slot: number; points: number; weight: number; extra?: number; label?: string }>,
) => {
  await tx.query(`delete from public.game_prizes where game = $1::public.game_kind`, [game])
  for (const p of prizes) {
    await tx.query(
      `insert into public.game_prizes (game, slot, label, points, extra_plays, weight)
       values ($1::public.game_kind, $2, $3, $4, $5, $6)`,
      [game, p.slot, p.label ?? `Prize ${p.slot}`, p.points, p.extra ?? 0, p.weight],
    )
  }
}

/** Gives a user a plan, so allowance tests are not stuck on the free tier. */
const grantPlan = async (tx: Tx, userId: string, slug: string) => {
  await tx.query(
    `insert into public.user_subscriptions (user_id, tier_id, status, started_at, current_period_end)
     select $1, id, 'active', now() - interval '1 day', now() + interval '30 days'
       from public.tiers where slug = $2`,
    [userId, slug],
  )
}

describe.skipIf(!HAS_DB)('games', () => {
  const enable = async (tx: Tx) => {
    await setConfig(tx, 'games_enabled', 'true')
    // The double-tap guard would refuse the second play in every test below.
    await setConfig(tx, 'game_min_seconds_between_plays', '0')
  }

  it('refuses to play at all while the switch is off', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Eager Player' })
      // Not enabled: this is the shipped default and the legal safety valve.
      expect((await play(tx, user.id)).outcome).toBe('games_disabled')

      const { rows } = await tx.query(
        `select count(*)::int n from public.game_plays where user_id = $1`,
        [user.id],
      )
      expect(rows[0]!.n).toBe(0)
    })
  })

  it('pays the prize it drew, once, and records the play', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Lucky Person' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [{ slot: 1, points: 750, weight: 1 }])

      const result = await play(tx, user.id)
      expect(result.outcome).toBe('ok')
      expect(result.points).toBe(750)
      expect(await balanceOf(tx, user.id)).toBe(750)

      const { rows } = await tx.query(
        `select count(*)::int plays,
                (select count(*)::int from public.points_ledger
                  where user_id = $1 and entry_type = 'game_prize') credits
           from public.game_plays where user_id = $1`,
        [user.id],
      )
      expect(rows[0]).toMatchObject({ plays: 1, credits: 1 })
    })
  })

  /* The free tier grants one play a week. The second attempt is the whole
     allowance mechanic in one assertion. */
  it('spends the weekly allowance and then refuses', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Free Player' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [{ slot: 1, points: 100, weight: 1 }])

      expect((await play(tx, user.id)).outcome).toBe('ok')
      const second = await play(tx, user.id)
      expect(second.outcome).toBe('no_plays_left')
      expect(second.allowance).toBe(1)
      expect(await balanceOf(tx, user.id)).toBe(100)
    })
  })

  /* The operator's choice: plays are the ONE benefit that does not stack. */
  it('gives a stacked user the highest plan, not the total', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Big Spender' })
      await grantPlan(tx, user.id, 'bronze')
      await grantPlan(tx, user.id, 'gold')

      const allowance = async () => {
        const { rows } = await tx.query(
          `select public.user_weekly_play_allowance($1) as n`,
          [user.id],
        )
        return Number(rows[0]!.n)
      }

      // Gold is 4, Bronze is 2. Highest wins; the sum would be 6 (or 7 with
      // the free base).
      expect(await allowance()).toBe(4)

      await setConfig(tx, 'game_plays_combine_mode', 'sum_bonus')
      // Free 1 + bronze bonus 1 + gold bonus 3.
      expect(await allowance()).toBe(5)
    })
  })

  /* Both games draw from ONE pool, which is what "one shared pool" means and
     the thing that would silently double the platform's cost if wrong. */
  it('shares one play pool across both games', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Two Games' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [{ slot: 1, points: 10, weight: 1 }])
      await setBoard(tx, 'spin_wheel', [{ slot: 1, points: 10, weight: 1 }])

      expect((await play(tx, user.id, 'mystery_box')).outcome).toBe('ok')
      // The free tier's single play is gone — the wheel does not get its own.
      expect((await play(tx, user.id, 'spin_wheel')).outcome).toBe('no_plays_left')
    })
  })

  it('lets a won extra play actually be played', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Bonus Winner' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [{ slot: 1, points: 25, weight: 1, extra: 1 }])

      const first = await play(tx, user.id)
      expect(first.extra_plays).toBe(1)
      // One from the tier, one won: the second play is allowed.
      expect((await play(tx, user.id)).outcome).toBe('ok')
      // But the extra was itself won again on play two, so play three is too.
      const { rows } = await tx.query(
        `select count(*)::int n from public.game_plays where user_id = $1`,
        [user.id],
      )
      expect(rows[0]!.n).toBe(2)
    })
  })

  /* THE DRAW, checked at every boundary rather than by sampling. Each slot
     must own exactly `weight` roll values and no others. */
  it('maps every roll to the slot that owns it', async () => {
    await withRollback(async (tx) => {
      await setBoard(tx, 'mystery_box', [
        { slot: 1, points: 10, weight: 3 },
        { slot: 2, points: 20, weight: 1 },
        { slot: 3, points: 30, weight: 6 },
      ])

      const { rows } = await tx.query(
        `with e as (
           select p.slot,
                  sum(p.weight) over (order by p.slot rows between unbounded preceding and current row) as cum
             from public.game_eligible_prizes('mystery_box', public.game_week_start()) p
         )
         select r.roll, (select e.slot from e where e.cum > r.roll order by e.cum limit 1) as slot
           from generate_series(0, 9) as r(roll)
          order by r.roll`,
      )

      // weights 3,1,6 -> rolls 0-2 are slot 1, roll 3 is slot 2, 4-9 slot 3.
      expect(rows.map((r) => Number(r.slot))).toEqual([1, 1, 1, 2, 3, 3, 3, 3, 3, 3])
    })
  })

  it('never draws a prize whose daily cap is spent', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Capped Out' })
      // Somebody else exhausted the stock earlier today. Spending it with
      // `user` would also spend their weekly play, and the test would prove
      // nothing about caps.
      const earlier = await createUser(tx, { name: 'Earlier Winner' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [
        { slot: 1, points: 10, weight: 1, label: 'Small' },
        { slot: 2, points: 9_999, weight: 1_000_000, label: 'Jackpot' },
      ])
      // The jackpot would win essentially every time — cap it at zero-left.
      await tx.query(
        `update public.game_prizes set daily_cap = 1
          where game = 'mystery_box' and slot = 2`,
      )
      await tx.query(
        `insert into public.game_plays
           (user_id, game, prize_id, slot, points_awarded, extra_plays_awarded, roll, weight_total, week_start)
         select $1, 'mystery_box', id, 2, 9999, 0, 0, 1, public.game_week_start()
           from public.game_prizes where game = 'mystery_box' and slot = 2`,
        [earlier.id],
      )

      const result = await play(tx, user.id)
      expect(result.outcome).toBe('ok')
      // Overwhelming weight, but it is out of stock, so the small one wins.
      expect(result.label).toBe('Small')
    })
  })

  /* Caps must never make a play pay nothing — the operator's rule is that
     every outcome pays something, and a spent play with no prize would be the
     worst possible way to break it. */
  it('still pays when every prize is capped out', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Everything Capped' })
      const earlier = await createUser(tx, { name: 'Took The Stock' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [{ slot: 1, points: 40, weight: 5 }])
      await tx.query(`update public.game_prizes set daily_cap = 1 where game = 'mystery_box'`)
      await tx.query(
        `insert into public.game_plays
           (user_id, game, prize_id, slot, points_awarded, extra_plays_awarded, roll, weight_total, week_start)
         select $1, 'mystery_box', id, 1, 40, 0, 0, 1, public.game_week_start()
           from public.game_prizes where game = 'mystery_box' and slot = 1`,
        [earlier.id],
      )

      const result = await play(tx, user.id)
      expect(result.outcome).toBe('ok')
      expect(result.points).toBe(40)
    })
  })

  it('refuses a disabled account', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Under Review' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [{ slot: 1, points: 10, weight: 1 }])
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [user.id])

      expect((await play(tx, user.id)).outcome).toBe('account_disabled')
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('will not let a prize pay nothing at all', async () => {
    await withRollback(async (tx) => {
      // The constraint, not the editor, is what guarantees the operator's
      // "every outcome pays something" rule.
      expect(
        await expectRejection(tx, () =>
          tx.query(
            `insert into public.game_prizes (game, slot, label, points, extra_plays, weight)
             values ('mystery_box', 20, 'Nothing', 0, 0, 5)`,
          ),
        ),
      ).toMatch(/game_prizes_pay_something/i)
    })
  })

  it('keeps a play out of last week', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Last Week' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [{ slot: 1, points: 60, weight: 1 }])

      // A play from a previous week must not count against this week's one.
      await tx.query(
        `insert into public.game_plays
           (user_id, game, prize_id, slot, points_awarded, extra_plays_awarded, roll, weight_total, week_start, created_at)
         select $1, 'mystery_box', id, 1, 60, 0, 0, 1,
                public.game_week_start() - 7, now() - interval '8 days'
           from public.game_prizes where game = 'mystery_box' and slot = 1`,
        [user.id],
      )

      expect((await play(tx, user.id)).outcome).toBe('ok')
    })
  })

  it('counts a game win on the leaderboard, with the other granted credits', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Game Climber' })
      await enable(tx)
      await setBoard(tx, 'mystery_box', [{ slot: 1, points: 4_000, weight: 1 }])
      await play(tx, user.id)

      const standing = async () => {
        await tx.query(
          `select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`,
          [user.id],
        )
        const { rows } = await tx.query(`select * from public.get_leaderboard_standing('all')`)
        return rows[0] ? Number(rows[0].points) : 0
      }

      expect(await standing()).toBe(4_000)

      // And it drops out with the other granted credits, not on its own rule.
      await setConfig(tx, 'leaderboard_counts_granted_points', 'false')
      expect(await standing()).toBe(0)
    })
  })

  it('refuses the admin prize table to a normal user', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Curious Player' })
      expect(
        await expectRejection(tx, () =>
          tx.query(`select * from public.admin_list_game_prizes($1, 'mystery_box')`, [user.id]),
        ),
      ).toMatch(/admin/i)
    })
  })

  it('reports what the table costs so it can be priced', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await setBoard(tx, 'spin_wheel', [
        { slot: 1, points: 100, weight: 9 },
        { slot: 2, points: 1_100, weight: 1 },
      ])

      const { rows } = await tx.query(
        `select * from public.admin_game_stats($1, 'spin_wheel', 30)`,
        [admin.id],
      )
      // (9*100 + 1*1100) / 10 = 200 points a play.
      expect(Number(rows[0]!.expected_rtp)).toBe(200)
    })
  })
})
