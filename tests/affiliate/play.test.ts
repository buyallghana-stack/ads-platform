import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, setConfig, withRollback } from '../support/db'

/**
 * Affiliate games, tasks and the earnings board (operator, 2026-08-07).
 *
 * All three pay CEDIS into `commission_ledger`, so every assertion here is
 * ultimately about a balance somebody can withdraw. The switch is flipped
 * inside a rolled-back transaction rather than on the project: turning
 * `affiliate_games_enabled` on for real, even briefly, would let any affiliate
 * with a training programme win real money in that window.
 *
 * The property worth more than the rest: A TASK PAYS ONCE. The operator's
 * rule is that somebody who reaches the top ten, is overtaken and climbs back
 * is not paid twice, "no one should be rewarded for an action that is already
 * completed". That is a unique constraint, not a status column, so a second
 * payment is unrepresentable.
 */

let seq = 0

/** An affiliate holding a training programme, which is where plays come from. */
const affiliate = async (
  tx: Tx,
  name: string,
  level: 'beginner' | 'professional' | null = 'professional',
) => {
  const user = await createUser(tx, { name })
  seq += 1

  await tx.query(
    `insert into public.affiliate_accounts (user_id, affiliate_code, status, activated_at)
     values ($1, public.generate_affiliate_code(), 'active', now())`,
    [user.id],
  )
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.affiliate_accounts where user_id = $1`,
    [user.id],
  )
  const affiliateId = rows[0]!.id

  if (level) {
    /* The tier lives on the training PROGRAMME, not on the entitlement, which
       is the one thing that made the allowance lookup non-obvious. */
    const { rows: program } = await tx.query<{ id: string; product_id: string }>(
      `select tp.id, tp.product_id from public.training_programs tp
        where tp.level::text = $1 limit 1`,
      [level],
    )
    if (program.length) {
      /* ⚠️ `affiliate_entitlements.order_id` is NOT NULL: an entitlement in
         this schema always came from a purchase, so the fixture has to buy
         the programme rather than be handed it. */
      const { rows: order } = await tx.query<{ id: string }>(
        `insert into public.orders
           (user_id, product_id, kind, amount_minor, list_price_minor, method, status, confirmed_at)
         values ($1, $2, 'purchase', 15000, 15000, 'paystack', 'confirmed', now())
         returning id`,
        [user.id, program[0]!.product_id],
      )
      await tx.query(
        `insert into public.affiliate_entitlements
           (affiliate_id, training_program_id, order_id, commission_depth,
            starts_at, expires_at, grace_ends_at, status)
         values ($1, $2, $3, 1, now(), now() + interval '365 days',
                 now() + interval '370 days', 'active')`,
        [affiliateId, program[0]!.id, order[0]!.id],
      )
    }
  }

  return { user, affiliateId }
}

const balance = async (tx: Tx, affiliateId: string) => {
  const { rows } = await tx.query<{ b: string }>(
    `select public.affiliate_balance_minor($1)::text as b`,
    [affiliateId],
  )
  return Number(rows[0]!.b)
}

const credit = async (tx: Tx, affiliateId: string, minor: number, kind = 'adjustment') => {
  seq += 1
  await tx.query(
    `insert into public.commission_ledger
       (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
     values ($1, $2::public.commission_entry_type, $3, 'cleared', 'test', $4)`,
    [affiliateId, kind, minor, `play-test-${Date.now()}-${seq}`],
  )
}

describe.skipIf(!HAS_DB)('how many plays a week', () => {
  it('gives Professional more than Beginner, and both from config', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_weekly_plays_professional', '3')
      await setConfig(tx, 'affiliate_weekly_plays_beginner', '1')

      const pro = await affiliate(tx, 'Pro Player', 'professional')
      const beg = await affiliate(tx, 'Beginner Player', 'beginner')

      const allowance = async (userId: string) => {
        const { rows } = await tx.query<{ n: number }>(
          `select public.affiliate_weekly_play_allowance($1) as n`,
          [userId],
        )
        return rows[0]!.n
      }

      expect(await allowance(pro.user.id)).toBe(3)
      expect(await allowance(beg.user.id)).toBe(1)
    })
  })

  it('gives none to somebody with no training programme', async () => {
    await withRollback(async (tx) => {
      const { user } = await affiliate(tx, 'No Programme', null)
      const { rows } = await tx.query<{ n: number }>(
        `select public.affiliate_weekly_play_allowance($1) as n`,
        [user.id],
      )
      /* The plays are a benefit of the programme. No programme, no benefit,
         and the screen says so rather than showing a play that fails. */
      expect(rows[0]!.n).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('playing', () => {
  it('refuses while the switch is off', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_games_enabled', 'false')
      const { user } = await affiliate(tx, 'Too Early')

      const message = await expectRejection(tx, () =>
        tx.query(`select public.play_affiliate_game($1, 'spin_wheel')`, [user.id]),
      )
      expect(message).toMatch(/not open yet/i)
    })
  })

  it('pays the prize into the commission balance and uses a play', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_games_enabled', 'true')
      const { user, affiliateId } = await affiliate(tx, 'Lucky One')

      expect(await balance(tx, affiliateId)).toBe(0)

      const { rows } = await tx.query<{ j: { amount_minor: number; status: { left: number } } }>(
        `select public.play_affiliate_game($1, 'spin_wheel') as j`,
        [user.id],
      )
      const won = Number(rows[0]!.j.amount_minor)

      /* Whatever the draw, the balance and the prize agree: a prize of zero
         credits nothing, and anything else lands in full. */
      expect(await balance(tx, affiliateId)).toBe(won)
      expect(rows[0]!.j.status.left).toBe(2)
    })
  })

  it('runs out after the allowance is spent', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_games_enabled', 'true')
      await setConfig(tx, 'affiliate_weekly_plays_professional', '1')
      const { user } = await affiliate(tx, 'One Play Only')

      await tx.query(`select public.play_affiliate_game($1, 'mystery_box')`, [user.id])
      const message = await expectRejection(tx, () =>
        tx.query(`select public.play_affiliate_game($1, 'mystery_box')`, [user.id]),
      )
      expect(message).toMatch(/no plays left/i)
    })
  })

  it('refuses somebody who is not an affiliate at all', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_games_enabled', 'true')
      const user = await createUser(tx, { name: 'Just A User' })

      const message = await expectRejection(tx, () =>
        tx.query(`select public.play_affiliate_game($1, 'spin_wheel')`, [user.id]),
      )
      expect(message).toMatch(/not an affiliate/i)
    })
  })
})

describe.skipIf(!HAS_DB)('tasks', () => {
  const task = async (tx: Tx, metric: string, target: number, reward: number) => {
    seq += 1
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.affiliate_tasks (code, name, metric, target, reward_minor)
       values ($1, $2, $3::public.affiliate_task_metric, $4, $5) returning id`,
      [`test-${Date.now()}-${seq}`, 'Test task', metric, target, reward],
    )
    return rows[0]!.id
  }

  it('refuses a claim before the target is reached', async () => {
    await withRollback(async (tx) => {
      const { user } = await affiliate(tx, 'Not Yet')
      const id = await task(tx, 'games_played', 1, 5_000)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.claim_affiliate_task($1, $2)`, [user.id, id]),
      )
      expect(message).toMatch(/not finished/i)
    })
  })

  it('pays the reward into the commission balance', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_games_enabled', 'true')
      const { user, affiliateId } = await affiliate(tx, 'Task Doer')
      const id = await task(tx, 'games_played', 1, 5_000)

      await tx.query(`select public.play_affiliate_game($1, 'mystery_box')`, [user.id])
      const before = await balance(tx, affiliateId)

      await tx.query(`select public.claim_affiliate_task($1, $2)`, [user.id, id])
      expect(await balance(tx, affiliateId)).toBe(before + 5_000)
    })
  })

  it('PAYS ONCE, and says so rather than raising a duplicate key', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_games_enabled', 'true')
      const { user, affiliateId } = await affiliate(tx, 'Twice Asker')
      const id = await task(tx, 'games_played', 1, 5_000)

      await tx.query(`select public.play_affiliate_game($1, 'mystery_box')`, [user.id])
      await tx.query(`select public.claim_affiliate_task($1, $2)`, [user.id, id])
      const after = await balance(tx, affiliateId)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.claim_affiliate_task($1, $2)`, [user.id, id]),
      )
      expect(message).toMatch(/already claimed/i)
      /* The refusal is not the point. The balance is. */
      expect(await balance(tx, affiliateId)).toBe(after)
    })
  })

  it('counts a rank DOWN to its target, not up', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_leaderboard_shows_zero_earners', 'false')
      const top = await affiliate(tx, 'Top Earner')
      await credit(tx, top.affiliateId, 900_000_000)

      const id = await task(tx, 'leaderboard_rank', 10, 2_500)

      const { rows } = await tx.query<{ j: { ready: boolean; progress: number }[] }>(
        `select public.get_affiliate_tasks($1) as j`,
        [top.user.id],
      )
      const mine = rows[0]!.j.find((t) => (t as unknown as { id: string }).id === id)!

      /* Progress is a PLACE. First place against a target of 10 is ready;
         reading it as "1 of 10" would say the opposite. */
      expect(mine.progress).toBe(1)
      expect(mine.ready).toBe(true)

      await tx.query(`select public.claim_affiliate_task($1, $2)`, [top.user.id, id])
      const message = await expectRejection(tx, () =>
        tx.query(`select public.claim_affiliate_task($1, $2)`, [top.user.id, id]),
      )
      expect(message).toMatch(/already claimed/i)
    })
  })
})

describe.skipIf(!HAS_DB)('the earnings board', () => {
  it('ranks by cleared commission, and a reversal counts against it', async () => {
    await withRollback(async (tx) => {
      const a = await affiliate(tx, 'Board Alpha')
      const b = await affiliate(tx, 'Board Beta')

      /* Nine figures so the pair tops a board that has real accounts on it.
         Movement is a rank against EVERYBODY and cannot be filtered, which is
         the same trap the points leaderboard test documents. */
      await credit(tx, a.affiliateId, 800_000_000)
      await credit(tx, b.affiliateId, 900_000_000)

      const board = async () => {
        const { rows } = await tx.query<{ user_id: string; amount_minor: string; rank: string }>(
          `select * from public.affiliate_leaderboard('all', 500)`,
        )
        return rows
      }

      let rows = await board()
      expect(rows[0]!.user_id).toBe(b.user.id)
      expect(rows[1]!.user_id).toBe(a.user.id)

      /* A clawed-back sale did not happen. Beta drops below Alpha. */
      await credit(tx, b.affiliateId, -200_000_000, 'reversal')

      rows = await board()
      expect(rows[0]!.user_id).toBe(a.user.id)
      expect(Number(rows.find((r) => r.user_id === b.user.id)!.amount_minor)).toBe(700_000_000)
    })
  })

  it('does not treat a withdrawal as un-earning', async () => {
    await withRollback(async (tx) => {
      const a = await affiliate(tx, 'Board Payer')
      await credit(tx, a.affiliateId, 500_000_000)

      const before = await tx.query<{ amount_minor: string }>(
        `select amount_minor from public.affiliate_leaderboard('all', 500) where user_id = $1`,
        [a.user.id],
      )

      await credit(tx, a.affiliateId, -100_000_000, 'payout')

      const after = await tx.query<{ amount_minor: string }>(
        `select amount_minor from public.affiliate_leaderboard('all', 500) where user_id = $1`,
        [a.user.id],
      )

      /* Taking money out is not earning less. The balance falls; the standing
         does not. */
      expect(after.rows[0]!.amount_minor).toBe(before.rows[0]!.amount_minor)
    })
  })
})
