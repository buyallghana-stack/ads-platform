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
 * Team milestones.
 *
 * A milestone is a task on the `team_members` metric with `cumulative` set:
 * its reward is the TOTAL at that rung and a claim pays the difference from
 * what the person has already been paid on the ladder. The risks are paying a
 * rung twice (the count can fall and rise again), paying the full total at
 * every rung instead of the difference, and counting people who are not on an
 * active paid plan.
 *
 * Every test pins its OWN ladder: the seeded rungs are deactivated inside the
 * transaction and the operator's figures are written again through
 * admin_save_task, so retuning the live ladder in the admin cannot turn this
 * file red (the lesson of tests-must-not-inherit-live-prices).
 */

/** The operator's brief, in cedis: members -> TOTAL milestone value. */
const LADDER: Array<[members: number, ghs: number]> = [
  [5, 50],
  [10, 100],
  [15, 200],
  [40, 600],
  [80, 1_500],
  [150, 3_500],
  [250, 8_000],
  [400, 17_500],
  [600, 45_000],
  [850, 100_000],
  [1_200, 300_000],
]

/** Points per cedi for the test ladder. Written into the rungs directly, so
 *  the live peg does not matter here. */
const PEG = 100

/** The highest total a count reaches, in cedis. */
const totalAt = (members: number) =>
  LADDER.filter(([m]) => m <= members).reduce((top, [, ghs]) => Math.max(top, ghs), 0)

type Rungs = Map<number, string>

async function pinLadder(tx: Tx, adminId: string, ladder = LADDER): Promise<Rungs> {
  await tx.query(`update public.tasks set is_active = false where cumulative`)
  const rungs: Rungs = new Map()
  for (const [members, ghs] of ladder) {
    const { rows } = await tx.query(`select public.admin_save_task($1, $2::jsonb) as id`, [
      adminId,
      JSON.stringify({
        code: `tm_test_${members}_${Math.random().toString(36).slice(2, 8)}`,
        name: `Team of ${members}`,
        description: 'A milestone written by a test.',
        metric: 'team_members',
        target: members,
        reward_points: ghs * PEG,
        icon: '🤝',
        sort_order: 0,
        is_active: true,
        cumulative: true,
      }),
    ])
    rungs.set(members, rows[0]!.id as string)
  }
  return rungs
}

/**
 * `n` new people on `referrerId`'s first level, each holding a plan. Built
 * in bulk (three statements, however large n is) because the ladder tops out
 * at 1,200 and one createUser per member would take minutes.
 */
async function grow(
  tx: Tx,
  referrerId: string,
  n: number,
  options: { tier?: string; status?: 'active' | 'grace' | 'expired' | 'cancelled' | null } = {},
): Promise<string[]> {
  const { tier = 'bronze', status = 'active' } = options
  if (n <= 0) return []

  const { rows } = await tx.query<{ id: string }>(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     select gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated',
            'tm-' || replace(gen_random_uuid()::text, '-', '') || '@test.invalid',
            'not-a-real-password', now(),
            jsonb_build_object('full_name', 'Team Member'),
            now() - interval '30 days', now()
       from generate_series(1, $1::int)
     returning id`,
    [n],
  )
  const ids = rows.map((r) => r.id)

  await tx.query(
    `insert into public.referrals (referrer_id, referee_id, code_used)
     select $1, x, 'TESTCODE' from unnest($2::uuid[]) as x`,
    [referrerId, ids],
  )

  if (status) {
    await tx.query(
      `insert into public.user_subscriptions (user_id, tier_id, status, current_period_end)
       select x, (select id from public.tiers where slug = $2), $3::public.subscription_status,
              now() + interval '30 days'
         from unnest($1::uuid[]) as x`,
      [ids, tier, status],
    )
  }
  return ids
}

const count = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query(
    `select public.user_task_metric($1, 'team_members') as v`,
    [userId],
  )
  return Number(rows[0]!.v)
}

const claim = async (tx: Tx, userId: string, taskId: string) => {
  const { rows } = await tx.query(`select public.claim_task($1, $2) as r`, [userId, taskId])
  return rows[0]!.r as { outcome: string; points?: number; rungs?: number }
}

const state = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query(`select public.team_milestones($1) as s`, [userId])
  return rows[0]!.s as {
    team_members: number
    paid_points: number
    current: { target: number; total_points: number } | null
    next: { target: number; total_points: number; needed: number; payout_points: number } | null
    claimable_task_id: string | null
    claimable_points: number
    rungs: Array<{ target: number; total_points: number; step_points: number; paid_points: number | null }>
    history: Array<{
      target: number
      previous_total_points: number
      milestone_total_points: number
      paid_points: number
      members_at_claim: number
    }>
  }
}

const milestoneCredits = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query(
    `select count(*)::int n, coalesce(sum(amount), 0)::bigint total
       from public.points_ledger
      where user_id = $1 and entry_type = 'task_reward'
        and (metadata ->> 'milestone')::boolean`,
    [userId],
  )
  return { n: rows[0]!.n as number, total: Number(rows[0]!.total) }
}

/** Any rung will do as the claim target: a claim takes the whole ladder. */
const anyRung = (rungs: Rungs) => rungs.get(5)!

describe.skipIf(!HAS_DB)('team milestones', () => {
  /* THE BRIEF'S OWN TABLE, walked one boundary at a time: at every count the
     operator listed, the payout is the new total less the old one, and a
     count just short of a rung pays nothing. */
  it('pays exactly the difference at every boundary from 4 to 1,200', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const leader = await createUser(tx, { name: 'Leader' })
      const rungs = await pinLadder(tx, admin.id)

      const checkpoints = [
        4, 5, 9, 10, 14, 15, 39, 40, 79, 80, 149, 150, 249, 250,
        399, 400, 599, 600, 849, 850, 1_199, 1_200,
      ]

      let members = 0
      let paidGhs = 0
      for (const target of checkpoints) {
        await grow(tx, leader.id, target - members)
        members = target
        expect(await count(tx, leader.id)).toBe(target)

        const before = await balanceOf(tx, leader.id)
        const result = await claim(tx, leader.id, anyRung(rungs))
        const owed = totalAt(target) - paidGhs

        if (owed > 0) {
          expect(result.outcome, `claim at ${target}`).toBe('ok')
          expect(Number(result.points), `payout at ${target}`).toBe(owed * PEG)
        } else {
          // 4 has not reached a rung; 9, 14, 39 ... have nothing new to claim.
          expect(['not_finished', 'already_claimed'], `claim at ${target}`).toContain(result.outcome)
        }
        expect(await balanceOf(tx, leader.id)).toBe(before + owed * PEG)

        // Claiming again straight away, and reading the panel (the
        // "dashboard refresh"), never pays anything more.
        expect(['already_claimed', 'not_finished']).toContain(
          (await claim(tx, leader.id, anyRung(rungs))).outcome,
        )
        await state(tx, leader.id)
        expect(await balanceOf(tx, leader.id)).toBe(before + owed * PEG)

        paidGhs += owed
      }

      // All eleven rungs: GHS 300,000 in total, NOT the GHS 476,450 sum.
      expect(paidGhs).toBe(300_000)
      const credits = await milestoneCredits(tx, leader.id)
      expect(credits).toEqual({ n: 11, total: 300_000 * PEG })

      // The audit trail the brief asked for, one row per rung.
      const s = await state(tx, leader.id)
      const history = [...s.history].sort((a, b) => a.target - b.target)
      expect(history.map((h) => [h.target, h.previous_total_points / PEG, h.milestone_total_points / PEG, h.paid_points / PEG])).toEqual([
        [5, 0, 50, 50],
        [10, 50, 100, 50],
        [15, 100, 200, 100],
        [40, 200, 600, 400],
        [80, 600, 1_500, 900],
        [150, 1_500, 3_500, 2_000],
        [250, 3_500, 8_000, 4_500],
        [400, 8_000, 17_500, 9_500],
        [600, 17_500, 45_000, 27_500],
        [850, 45_000, 100_000, 55_000],
        [1_200, 100_000, 300_000, 200_000],
      ])
      expect(s.paid_points).toBe(300_000 * PEG)
      expect(s.next).toBeNull()
    })
  })

  /* Jumping across several rungs claims each of them, lowest first, and the
     total is the total at the highest one. */
  it('pays 50 + 50 + 100 + 400 when a team jumps from 4 to 40', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const leader = await createUser(tx, { name: 'Jumper' })
      const rungs = await pinLadder(tx, admin.id)

      await grow(tx, leader.id, 4)
      expect((await claim(tx, leader.id, anyRung(rungs))).outcome).toBe('not_finished')

      await grow(tx, leader.id, 36)
      // Claimed through the 40 rung's id, not the 5: either reaches the ladder.
      const result = await claim(tx, leader.id, rungs.get(40)!)
      expect(result.outcome).toBe('ok')
      expect(Number(result.points)).toBe(600 * PEG)
      expect(Number(result.rungs)).toBe(4)

      const { rows } = await tx.query(
        `select t.target, c.reward_points from public.task_completions c
           join public.tasks t on t.id = c.task_id
          where c.user_id = $1 order by t.target`,
        [leader.id],
      )
      expect(rows.map((r) => [Number(r.target), Number(r.reward_points) / PEG])).toEqual([
        [5, 50], [10, 50], [15, 100], [40, 400],
      ])
      expect(await milestoneCredits(tx, leader.id)).toEqual({ n: 4, total: 600 * PEG })
    })
  })

  it('pays GHS 300,000 once, not GHS 476,450, for a jump from nothing to 1,200', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const leader = await createUser(tx, { name: 'Straight To The Top' })
      const rungs = await pinLadder(tx, admin.id)

      await grow(tx, leader.id, 1_200)
      const result = await claim(tx, leader.id, anyRung(rungs))
      expect(Number(result.points)).toBe(300_000 * PEG)
      expect(Number(result.rungs)).toBe(11)
      expect(await balanceOf(tx, leader.id)).toBe(300_000 * PEG)

      // Every rung, by any of their ids, now refuses.
      for (const id of rungs.values()) {
        expect((await claim(tx, leader.id, id)).outcome).toBe('already_claimed')
      }
      expect(await milestoneCredits(tx, leader.id)).toEqual({ n: 11, total: 300_000 * PEG })
    })
  })

  /* THE OPERATOR'S EXPLICIT CONDITION: a rung never pays twice for the same
     achievement. Option 3 counts ACTIVE plans, so a team can shrink below a
     rung and grow back past it; the second crossing pays nothing, and the
     shrink takes nothing back. */
  it('never pays a rung twice when the team shrinks and grows back, and claws nothing back', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const leader = await createUser(tx, { name: 'Up And Down' })
      const rungs = await pinLadder(tx, admin.id)

      const team = await grow(tx, leader.id, 15)
      expect(Number((await claim(tx, leader.id, anyRung(rungs))).points)).toBe(200 * PEG)
      const paid = await balanceOf(tx, leader.id)

      // Six plans lapse: 9 members, below the 10 and 15 rungs.
      await tx.query(
        `update public.user_subscriptions set status = 'expired' where user_id = any($1::uuid[])`,
        [team.slice(0, 6)],
      )
      expect(await count(tx, leader.id)).toBe(9)
      expect(await balanceOf(tx, leader.id)).toBe(paid)
      const low = await state(tx, leader.id)
      expect(low.current?.target).toBe(5)
      expect(low.claimable_points).toBe(0)
      expect(low.paid_points).toBe(200 * PEG)

      // Renewed: back to 15. Nothing new to claim.
      await tx.query(
        `update public.user_subscriptions set status = 'active' where user_id = any($1::uuid[])`,
        [team.slice(0, 6)],
      )
      expect(await count(tx, leader.id)).toBe(15)
      expect((await claim(tx, leader.id, rungs.get(15)!)).outcome).toBe('already_claimed')
      expect(await balanceOf(tx, leader.id)).toBe(paid)

      // Growing on to the NEXT rung pays only that rung's difference.
      await grow(tx, leader.id, 25)
      expect(Number((await claim(tx, leader.id, anyRung(rungs))).points)).toBe(400 * PEG)
      expect(await milestoneCredits(tx, leader.id)).toEqual({ n: 4, total: 600 * PEG })
    })
  })

  /* Option 3's definition, branch by branch. */
  it('counts both levels on an active or grace paid plan, and nobody else', async () => {
    await withRollback(async (tx) => {
      const leader = await createUser(tx, { name: 'Counted' })

      const [first] = await grow(tx, leader.id, 1)
      expect(await count(tx, leader.id)).toBe(1)

      // Level two counts; level three does not exist.
      const [second] = await grow(tx, first!, 1)
      await grow(tx, second!, 3)
      expect(await count(tx, leader.id)).toBe(2)

      // Never bought, on the free tier, expired or cancelled: not counted.
      await grow(tx, leader.id, 1, { status: null })
      await grow(tx, leader.id, 1, { tier: 'free' })
      await grow(tx, leader.id, 1, { status: 'expired' })
      await grow(tx, leader.id, 1, { status: 'cancelled' })
      expect(await count(tx, leader.id)).toBe(2)

      // Grace is still holding a plan, the same test the Team screen uses.
      const [graced] = await grow(tx, leader.id, 1, { status: null })
      await tx.query(
        `insert into public.user_subscriptions (user_id, tier_id, status, current_period_end, grace_ends_at)
         select $1, id, 'grace', now() - interval '1 day', now() + interval '2 days'
           from public.tiers where slug = 'silver'`,
        [graced],
      )
      expect(await count(tx, leader.id)).toBe(3)

      // Stacking plans is still one person.
      await tx.query(
        `insert into public.user_subscriptions (user_id, tier_id, status, current_period_end)
         select $1, id, 'active', now() + interval '30 days' from public.tiers where slug = 'gold'`,
        [first],
      )
      expect(await count(tx, leader.id)).toBe(3)

      // A rejected link drops out, and so does the level two behind it.
      await tx.query(`update public.referrals set status = 'rejected' where referee_id = $1`, [first])
      expect(await count(tx, leader.id)).toBe(1)
      await tx.query(`update public.referrals set status = 'pending' where referee_id = $1`, [first])

      // A disabled member stops counting.
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [second])
      expect(await count(tx, leader.id)).toBe(2)
    })
  })

  /* The brief's own worked example for the screen. */
  it('reports 73 members as: at 40, GHS 600 earned, 7 to go, next pays GHS 900', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const leader = await createUser(tx, { name: 'Seventy Three' })
      const rungs = await pinLadder(tx, admin.id)

      await grow(tx, leader.id, 73)

      // Before claiming: GHS 600 is waiting.
      const waiting = await state(tx, leader.id)
      expect(waiting.claimable_points).toBe(600 * PEG)
      expect(waiting.claimable_task_id).not.toBeNull()
      expect(waiting.next?.payout_points).toBe(900 * PEG)

      await claim(tx, leader.id, waiting.claimable_task_id ?? anyRung(rungs))
      const s = await state(tx, leader.id)

      expect(s.team_members).toBe(73)
      expect(s.current).toEqual({ target: 40, total_points: 600 * PEG })
      expect(s.paid_points).toBe(600 * PEG)
      expect(s.next).toEqual({
        target: 80,
        total_points: 1_500 * PEG,
        needed: 7,
        payout_points: 900 * PEG,
      })
      expect(s.claimable_task_id).toBeNull()
      expect(s.claimable_points).toBe(0)
      expect(s.rungs.map((r) => r.step_points / PEG)).toEqual([
        50, 50, 100, 400, 900, 2_000, 4_500, 9_500, 27_500, 55_000, 200_000,
      ])
    })
  })

  /* The totals live in one place, the rungs, and can be changed. A claim
     always tops the person up to the rung's CURRENT total, never past it. */
  it('follows an edited total without overpaying, and records a rung that owes nothing', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const leader = await createUser(tx, { name: 'Repriced' })
      const rungs = await pinLadder(tx, admin.id)

      await grow(tx, leader.id, 10)
      expect(Number((await claim(tx, leader.id, anyRung(rungs))).points)).toBe(100 * PEG)

      // The operator raises the 15 rung from GHS 200 to GHS 250.
      const edit = async (members: number, ghs: number) => {
        const { rows } = await tx.query(`select row_to_json(t) r from public.tasks t where id = $1`, [
          rungs.get(members),
        ])
        const t = rows[0]!.r
        await tx.query(`select public.admin_save_task($1, $2::jsonb)`, [
          admin.id,
          JSON.stringify({ ...t, reward_points: ghs * PEG }),
        ])
      }
      await edit(15, 250)
      await grow(tx, leader.id, 5)
      expect(Number((await claim(tx, leader.id, anyRung(rungs))).points)).toBe(150 * PEG)
      expect(await balanceOf(tx, leader.id)).toBe(250 * PEG)
    })
  })

  it('refuses a ladder that does not climb, and freezes a claimed rung', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const leader = await createUser(tx, { name: 'Frozen' })
      const rungs = await pinLadder(tx, admin.id)

      const rung = async (members: number) => {
        const { rows } = await tx.query(`select row_to_json(t) r from public.tasks t where id = $1`, [
          rungs.get(members),
        ])
        return rows[0]!.r
      }

      const save = (task: object) =>
        tx.query(`select public.admin_save_task($1, $2::jsonb)`, [admin.id, JSON.stringify(task)])

      // The 40 rung priced below the 15 rung.
      const forty = await rung(40)
      expect(await expectRejection(tx, () => save({ ...forty, reward_points: 150 * PEG }))).toMatch(
        /must climb/,
      )
      // A second rung at the same member count.
      const ten = await rung(10)
      expect(await expectRejection(tx, () => save({ ...ten, target: 15 }))).toMatch(/must climb/)

      // A claimed rung cannot stop being a rung.
      await grow(tx, leader.id, 5)
      await claim(tx, leader.id, anyRung(rungs))
      const five = await rung(5)
      expect(await expectRejection(tx, () => save({ ...five, cumulative: false }))).toMatch(
        /already completed/,
      )
    })
  })

  /* Separate from referral commissions: claiming writes none, and the
     ordinary task list does not show the rungs as "+300,000" cards. */
  it('writes no referral commission and stays off the ordinary task list', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const leader = await createUser(tx, { name: 'Separate' })
      const rungs = await pinLadder(tx, admin.id)

      await grow(tx, leader.id, 5)
      await claim(tx, leader.id, anyRung(rungs))

      const { rows } = await tx.query(
        `select count(*)::int n from public.referral_commissions where referrer_id = $1`,
        [leader.id],
      )
      expect(rows[0]!.n).toBe(0)

      const { rows: ids } = await tx.query(`select array_agg(id) ids from public.tasks where cumulative`)
      await actAs(tx, leader.id)
      const { rows: listed } = await tx.query(
        `select count(*)::int n from public.get_tasks() where id = any($1::uuid[])`,
        [ids[0]!.ids],
      )
      expect(listed[0]!.n).toBe(0)
    })
  })
})
