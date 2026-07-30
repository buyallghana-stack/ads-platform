import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  actAs,
  balanceOf,
  createAdmin,
  createUser,
  expectRejection,
  withRollback,
} from '../support/db'

/**
 * Tasks.
 *
 * A task pays points, so the risks are: paying twice, paying for something
 * the user has not done, and a progress bar that disagrees with the button
 * beside it. The last one is why `user_task_metric` is a single function —
 * the bar and the claim check read the same number by construction — and the
 * tests below go through both paths to prove they still agree.
 */

const newTask = async (
  tx: Tx,
  adminId: string,
  task: Partial<{ code: string; metric: string; target: number; reward: number }> = {},
) => {
  const code = task.code ?? `t_${Math.random().toString(36).slice(2, 10)}`
  const { rows } = await tx.query(
    `select public.admin_save_task($1, $2::jsonb) as id`,
    [
      adminId,
      JSON.stringify({
        code,
        name: 'Test task',
        description: 'A task written by a test.',
        metric: task.metric ?? 'ads_watched',
        target: task.target ?? 3,
        reward_points: task.reward ?? 500,
        icon: 'Target',
        sort_order: 0,
        is_active: true,
      }),
    ],
  )
  return rows[0]!.id as string
}

const claim = async (tx: Tx, userId: string, taskId: string) => {
  const { rows } = await tx.query(`select public.claim_task($1, $2) as r`, [userId, taskId])
  return rows[0]!.r as { outcome: string; points?: number; progress?: number; target?: number }
}

/** A counted credit, so a metric has something to count. */
const credit = async (tx: Tx, userId: string, entryType: string, times: number, amount = 100) => {
  for (let i = 0; i < times; i++) {
    await tx.query(
      `insert into public.points_ledger
         (user_id, entry_type, amount, balance_after, points_per_currency_unit)
       values ($1, $2::public.ledger_entry_type, $3::bigint, greatest($3::bigint, 0::bigint),
               public.config_int('points_per_currency_unit'))`,
      [userId, entryType, amount],
    )
  }
}

describe.skipIf(!HAS_DB)('tasks', () => {
  it('refuses a task the user has not finished, and pays nothing', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Not Yet' })
      const task = await newTask(tx, admin.id, { metric: 'ads_watched', target: 3 })
      await credit(tx, user.id, 'ad_view', 2)

      const result = await claim(tx, user.id, task)
      expect(result.outcome).toBe('not_finished')
      expect(Number(result.progress)).toBe(2)
      expect(Number(result.target)).toBe(3)

      const { rows } = await tx.query(
        `select count(*)::int n from public.task_completions where user_id = $1`,
        [user.id],
      )
      expect(rows[0]!.n).toBe(0)
    })
  })

  it('pays once when the target is met, and refuses a second claim', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Finisher' })
      const task = await newTask(tx, admin.id, { metric: 'ads_watched', target: 3, reward: 750 })
      await credit(tx, user.id, 'ad_view', 3)

      const before = await balanceOf(tx, user.id)
      const first = await claim(tx, user.id, task)
      expect(first.outcome).toBe('ok')
      expect(Number(first.points)).toBe(750)
      expect(await balanceOf(tx, user.id)).toBe(before + 750)

      // The unique constraint, not a status check, is what makes this true.
      expect((await claim(tx, user.id, task)).outcome).toBe('already_claimed')
      expect(await balanceOf(tx, user.id)).toBe(before + 750)

      const { rows } = await tx.query(
        `select count(*)::int n from public.points_ledger
          where user_id = $1 and entry_type = 'task_reward'`,
        [user.id],
      )
      expect(rows[0]!.n).toBe(1)
    })
  })

  /* THE OPERATOR'S RETROACTIVE CHOICE. Somebody who did the thing last month
     completes a task created this morning, with no backfill step. */
  it('is immediately claimable by somebody who already did the thing', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Old Hand' })
      await credit(tx, user.id, 'ad_view', 40)

      // The task is created AFTER the history exists.
      const task = await newTask(tx, admin.id, { metric: 'ads_watched', target: 10 })
      expect((await claim(tx, user.id, task)).outcome).toBe('ok')
    })
  })

  /* Every metric is checked, because each is a separate query and a wrong
     table would be invisible until somebody complained about a task that
     never completes. */
  it('measures every metric it offers', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Metric Person' })
      const read = async (metric: string) => {
        const { rows } = await tx.query(
          `select public.user_task_metric($1, $2::public.task_metric) as v`,
          [user.id, metric],
        )
        return Number(rows[0]!.v)
      }

      // Existing is enough for the Newbie task.
      expect(await read('account_created')).toBe(1)

      // Everything else starts at zero for a fresh account.
      for (const metric of [
        'plans_purchased', 'ads_watched', 'surveys_completed', 'points_earned',
        'referrals_activated', 'games_played', 'gift_codes_redeemed',
        'withdrawals_made', 'has_2fa', 'has_avatar', 'has_withdrawal_pin',
      ]) {
        expect(await read(metric), metric).toBe(0)
      }

      await credit(tx, user.id, 'ad_view', 2)
      await credit(tx, user.id, 'survey', 1)
      expect(await read('ads_watched')).toBe(2)
      expect(await read('surveys_completed')).toBe(1)

      /* `points_earned` reads `user_balances.lifetime_earned`, which the
         ledger TRIGGER maintains — so the raw inserts above do not move it,
         and a real credit is needed to test it. That is the metric being
         right, not wrong: lifetime_earned is the maintained total, and a task
         about reaching one should read the maintained total. */
      expect(await read('points_earned')).toBe(0)
      await tx.query(`select public.credit_points($1, 900, 'ad_view')`, [user.id])
      expect(await read('points_earned')).toBe(900)

      await tx.query(`update public.profiles set avatar_path = 'x/y.png' where id = $1`, [user.id])
      expect(await read('has_avatar')).toBe(1)

      await tx.query(
        `insert into public.user_security (user_id, pin_hash, totp_confirmed_at)
         values ($1, 'not-a-real-hash', now())`,
        [user.id],
      )
      expect(await read('has_withdrawal_pin')).toBe(1)
      expect(await read('has_2fa')).toBe(1)
    })
  })

  /* Anti-farming. Counting raw signups would pay somebody for creating
     accounts, which is the fraud the device layer exists to catch. */
  it('counts only referrals who actually watched an ad', async () => {
    await withRollback(async (tx) => {
      const inviter = await createUser(tx, { name: 'The Inviter' })
      const idle = await createUser(tx, { name: 'Signed Up Only' })
      const active = await createUser(tx, { name: 'Actually Watched' })

      await tx.query(`update public.profiles set referred_by = $1 where id in ($2, $3)`, [
        inviter.id,
        idle.id,
        active.id,
      ])

      const read = async () => {
        const { rows } = await tx.query(
          `select public.user_task_metric($1, 'referrals_activated') as v`,
          [inviter.id],
        )
        return Number(rows[0]!.v)
      }

      // Two signups, neither has watched anything.
      expect(await read()).toBe(0)

      await credit(tx, active.id, 'ad_view', 1)
      expect(await read()).toBe(1)
    })
  })

  /* Requesting a withdrawal and cancelling in a loop must not complete a
     task, so the metric counts money that actually left. */
  it('counts only withdrawals that were paid', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Cash Out' })
      const read = async () => {
        const { rows } = await tx.query(
          `select public.user_task_metric($1, 'withdrawals_made') as v`,
          [user.id],
        )
        return Number(rows[0]!.v)
      }

      await tx.query(
        `insert into public.redemptions
           (user_id, method, status, points_amount, points_per_currency_unit,
            currency_amount, currency_code, holding_until,
            snapshot_provider_code, snapshot_msisdn, snapshot_account_name)
         values ($1, 'mobile_money', 'held', 5000,
                 public.config_int('points_per_currency_unit'), 5.00, 'GHS',
                 now() + interval '48 hours', 'MTN', '0241234567', 'Test Person')`,
        [user.id],
      )
      expect(await read()).toBe(0)

      // `redemptions_paid_has_time` insists a paid row records WHEN — one of
      // several constraints on this table that make a half-written payout
      // unrepresentable.
      await tx.query(
        `update public.redemptions set status = 'paid', paid_at = now() where user_id = $1`,
        [user.id],
      )
      expect(await read()).toBe(1)
    })
  })

  it('shows the same progress on the board as the claim check uses', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Bar Watcher' })
      const task = await newTask(tx, admin.id, { metric: 'ads_watched', target: 5 })
      await credit(tx, user.id, 'ad_view', 5)

      await actAs(tx, user.id)
      const { rows } = await tx.query(`select * from public.get_tasks()`)
      const row = rows.find((r) => r.id === task)!

      expect(Number(row.progress)).toBe(5)
      expect(row.claimable).toBe(true)
      expect(row.claimed_at).toBeNull()

      // The button and the bar agree.
      expect((await claim(tx, user.id, task)).outcome).toBe('ok')

      const { rows: after } = await tx.query(`select * from public.get_tasks()`)
      const done = after.find((r) => r.id === task)!
      expect(done.claimable).toBe(false)
      expect(done.claimed_at).not.toBeNull()
    })
  })

  /* Progress is capped at the target so a bar never reads 812 of 50. */
  it('caps displayed progress at the target', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Overachiever' })
      const task = await newTask(tx, admin.id, { metric: 'ads_watched', target: 3 })
      await credit(tx, user.id, 'ad_view', 30)

      await actAs(tx, user.id)
      const { rows } = await tx.query(`select * from public.get_tasks()`)
      expect(Number(rows.find((r) => r.id === task)!.progress)).toBe(3)
    })
  })

  it('refuses a disabled account', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Under Review' })
      const task = await newTask(tx, admin.id, { metric: 'account_created', target: 1 })
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [user.id])

      expect((await claim(tx, user.id, task)).outcome).toBe('account_disabled')
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  /* Moving a goal under people who already finished would leave their
     completion recording something that never happened. */
  it('freezes the goal once anybody has completed the task', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'First Finisher' })
      const id = await newTask(tx, admin.id, { metric: 'ads_watched', target: 2 })
      await credit(tx, user.id, 'ad_view', 2)
      expect((await claim(tx, user.id, id)).outcome).toBe('ok')

      const payload = (target: number) =>
        JSON.stringify({
          id,
          code: 'ignored',
          name: 'Test task',
          description: 'A task written by a test.',
          metric: 'ads_watched',
          target,
          reward_points: 500,
          icon: 'Target',
          sort_order: 0,
          is_active: true,
        })

      expect(
        await expectRejection(tx, () =>
          tx.query(`select public.admin_save_task($1, $2::jsonb)`, [admin.id, payload(50)]),
        ),
      ).toMatch(/already completed/i)

      // The reward and the wording may still be edited.
      await tx.query(`select public.admin_save_task($1, $2::jsonb)`, [admin.id, payload(2)])
    })
  })

  it('archives rather than deletes a task somebody has claimed', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Claimer' })
      const id = await newTask(tx, admin.id, { metric: 'account_created', target: 1 })
      await claim(tx, user.id, id)

      const { rows } = await tx.query(`select public.admin_delete_task($1, $2) as r`, [admin.id, id])
      expect(rows[0]!.r).toBe('archived')

      const { rows: still } = await tx.query(
        `select is_active from public.tasks where id = $1`,
        [id],
      )
      expect(still[0]!.is_active).toBe(false)
    })
  })

  it('deletes a task nobody has touched', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const id = await newTask(tx, admin.id)
      const { rows } = await tx.query(`select public.admin_delete_task($1, $2) as r`, [admin.id, id])
      expect(rows[0]!.r).toBe('deleted')
    })
  })

  it('refuses the admin task list to a normal user', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Not An Admin' })
      expect(
        await expectRejection(tx, () => tx.query(`select * from public.admin_list_tasks($1)`, [user.id])),
      ).toMatch(/admin/i)
    })
  })

  it('refuses the board to a caller with no session', async () => {
    await withRollback(async (tx) => {
      expect(
        await expectRejection(tx, () => tx.query(`select * from public.get_tasks()`)),
      ).toMatch(/signed in/i)
    })
  })
})
