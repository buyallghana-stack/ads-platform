import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  actAs,
  actAsAdmin,
  createAdmin,
  createUser,
  expectRejection,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * The first-run walkthrough.
 *
 * The risk here is not that a tooltip renders in the wrong place. It is that
 * the checklist LIES: four of these steps are money preconditions, and a
 * checklist that ticks "payout account" because a bubble was dismissed tells
 * somebody they can withdraw when they cannot. So every test below is about
 * the difference between "was shown" and "is true".
 */

const state = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query(`select public.get_onboarding_state($1) as s`, [userId])
  return rows[0]!.s as {
    enabled: boolean
    started: boolean
    skipped: boolean
    completed: boolean
    currentStep: string | null
    steps: Array<{ key: string; done: boolean; walked: boolean }>
    total: number
    doneCount: number
    firstAdDone: boolean
    firstAdBlocked: boolean
    adPoints: number
  }
}

const done = (s: Awaited<ReturnType<typeof state>>, key: string) =>
  s.steps.find((x) => x.key === key)?.done

/** Gives a user a live plan, the way buying one would. */
const grantPlan = async (tx: Tx, userId: string, slug: string) => {
  await tx.query(
    `insert into public.user_subscriptions (user_id, tier_id, status, started_at, current_period_end)
     select $1, id, 'active', now() - interval '1 day', now() + interval '30 days'
       from public.tiers where slug = $2`,
    [userId, slug],
  )
}

describe.skipIf(!HAS_DB)('onboarding walkthrough', () => {
  it('starts a new member at the first step, with nothing ticked', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Brand New' })
      await actAs(tx, user.id)

      const s = await state(tx, user.id)
      expect(s.enabled).toBe(true)
      expect(s.currentStep).toBe('balance')
      expect(s.doneCount).toBe(0)
      expect(s.completed).toBe(false)
      // The whole ladder is offered, in the operator's order.
      /* The offer is LAST (operator, 2026-09-23): the plans are shown once
         the member has seen the whole product. */
      expect(s.steps.map((x) => x.key)).toEqual([
        'balance',
        'statement',
        'first_ad',
        'celebrate',
        'payout',
        'pin',
        'games',
        'community',
        'invite',
        'upgrade',
      ])
    })
  })

  /*
    ── THE ONE THAT MATTERS ──────────────────────────────────────────────────

    A client marking `payout` must not tick `payout`. If this ever passes the
    other way, the checklist is telling people they can be paid when no
    destination exists, which is the exact trust failure the product competes
    on not having.
  */
  it('will not let a dismissed bubble tick a money step', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Impatient' })
      await actAs(tx, user.id)

      for (const step of ['payout', 'pin', 'first_ad']) {
        await tx.query(`select public.mark_onboarding_step($1)`, [step])
      }

      const s = await state(tx, user.id)
      expect(done(s, 'payout')).toBe(false)
      expect(done(s, 'pin')).toBe(false)
      expect(done(s, 'first_ad')).toBe(false)
    })
  })

  it('ticks a money step when the real thing exists', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Set Up' })
      await actAs(tx, user.id)

      expect(done(await state(tx, user.id), 'pin')).toBe(false)

      await tx.query(
        `insert into public.user_security (user_id, pin_hash, pin_set_at)
         values ($1, 'not-a-real-hash', now())
         on conflict (user_id) do update set pin_hash = excluded.pin_hash`,
        [user.id],
      )

      expect(done(await state(tx, user.id), 'pin')).toBe(true)
    })
  })

  it('counts a shown step, and only the shown kind', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Walker' })
      await actAs(tx, user.id)

      await tx.query(`select public.mark_onboarding_step('balance')`)
      const s = await state(tx, user.id)

      expect(done(s, 'balance')).toBe(true)
      expect(s.currentStep).toBe('statement')
      expect(s.doneCount).toBe(1)
    })
  })

  /* The upgrade step must end either way. Holding somebody hostage until they
     pay is not a walkthrough, it is a paywall, and it would strand every
     member who is not buying today on step five for ever. */
  it('ends the upgrade step on a purchase or on a decline', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')

      const buyer = await createUser(tx, { name: 'Buyer' })
      await actAs(tx, buyer.id)
      await grantPlan(tx, buyer.id, 'bronze')
      expect(done(await state(tx, buyer.id), 'upgrade')).toBe(true)

      const decliner = await createUser(tx, { name: 'Not Today' })
      await actAs(tx, decliner.id)
      expect(done(await state(tx, decliner.id), 'upgrade')).toBe(false)
      await tx.query(`select public.mark_onboarding_step('upgrade')`)
      expect(done(await state(tx, decliner.id), 'upgrade')).toBe(true)
    })
  })

  it('reports that the first ad is unreachable when the pool is empty', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      // Nothing servable: every ad is switched off for the length of this test.
      await tx.query(`update public.ads set status = 'paused' where status = 'active'`)

      const user = await createUser(tx, { name: 'Nothing To Watch' })
      await actAs(tx, user.id)

      const s = await state(tx, user.id)
      expect(s.firstAdDone).toBe(false)
      expect(s.firstAdBlocked).toBe(true)
    })
  })

  it('goes dark for everybody when the switch is off', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'false')
      const user = await createUser(tx, { name: 'No Tour' })
      await actAs(tx, user.id)

      const s = await state(tx, user.id)
      expect(s.enabled).toBe(false)
      // Nothing else is promised when it is off; the client renders nothing.
      expect(s.currentStep).toBeUndefined()
    })
  })

  it('stops on a skip and keeps what was already true', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Had Enough' })
      await actAs(tx, user.id)

      await tx.query(`select public.mark_onboarding_step('balance')`)
      await tx.query(`select public.skip_onboarding()`)

      const s = await state(tx, user.id)
      expect(s.skipped).toBe(true)
      // The checklist stays useful: progress is not thrown away by stopping.
      expect(done(s, 'balance')).toBe(true)
    })
  })

  /* A replay must not un-tick a payout account. The steps that are FACTS stay
     true, and the walkthrough simply walks past them. */
  it('replays without pretending the real setup was undone', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Again' })
      await actAs(tx, user.id)

      await tx.query(
        `insert into public.user_security (user_id, pin_hash, pin_set_at)
         values ($1, 'not-a-real-hash', now())
         on conflict (user_id) do update set pin_hash = excluded.pin_hash`,
        [user.id],
      )
      await tx.query(`select public.mark_onboarding_step('balance')`)
      await tx.query(`select public.replay_onboarding()`)

      const s = await state(tx, user.id)
      expect(done(s, 'balance')).toBe(false)
      expect(done(s, 'pin')).toBe(true)
      expect(s.currentStep).toBe('balance')
    })
  })

  /*
    ── REPORTED ON A REAL ACCOUNT ────────────────────────────────────────────

    A member watched their first ad and then skipped the walkthrough, and the
    checklist went on telling them to "collect your first points" while the
    points were already in their balance. `celebrate` was a "has been shown"
    step, so skipping the sheet left it unticked for ever.

    The congratulation is a MOMENT, not a task: watching the first ad IS
    collecting the first points. The general rule it broke is worth keeping in
    mind for any step added later: a step may only be satisfied by having been
    SHOWN if a member who never sees it genuinely has not done the thing.
  */
  it('counts the first points as earned by the ad, not by seeing the congratulation', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Dereick' })
      await actAs(tx, user.id)

      /* Its own ad. The test database carries none, and reading "the first ad
         you find" made this test pass by finding nothing and asserting
         nothing, which is worse than no test. */
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.ads (title, format, status, points_reward, video_source,
                                 youtube_video_id, duration_seconds, min_watch_seconds, weight)
         values ('Onboarding fixture', 'video', 'active', 100, 'youtube', 'dQw4w9WgXcQ', 30, 0, 100)
         returning id`,
      )
      const adId = rows[0]!.id

      await tx.query(
        `insert into public.user_ad_state (user_id, ad_id, status, completed_at)
         values ($1, $2, 'completed', now())
         on conflict (user_id, ad_id) do update
           set status = 'completed', completed_at = now()`,
        [user.id, adId],
      )
      await tx.query(`select public.skip_onboarding()`)

      const s = await state(tx, user.id)
      expect(done(s, 'first_ad')).toBe(true)
      /* The checklist no longer LISTS the congratulation at all, which is the
         real fix for the reported lie: watching the first ad is collecting the
         first points, so there was never a second row to tick. The client
         filters it out; here we just prove the ad itself reads as done. */
    })
  })

  /*
    ── WALKING PAST IS NOT FINISHING ─────────────────────────────────────────

    Found by driving the real walkthrough: the only way past "add a payout
    account" was Skip, which ends the whole tour. Saying "not now" must move
    the walkthrough on WITHOUT ticking the checklist, because the account still
    does not exist and that row is what tells somebody whether they can be paid.
  */
  it('lets a member walk past a setup step without ticking it', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Not Right Now' })
      await actAs(tx, user.id)

      await tx.query(`select public.mark_onboarding_step('payout')`)
      const s = await state(tx, user.id)

      // The checklist still tells the truth.
      expect(done(s, 'payout')).toBe(false)
      // And the walkthrough has moved on rather than sitting on it.
      expect(s.steps.find((x) => x.key === 'payout')?.walked).toBe(true)
      expect(s.currentStep).not.toBe('payout')
    })
  })

  /* The congratulation is a moment, shown once. Migration 190 made it derived
     so the checklist would stop asking for it, which also meant it never
     appeared: the instant the ad landed the step counted as done and the
     walkthrough stepped over the best screen in the product. */
  it('still shows the congratulation after the first ad', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Deserves A Moment' })
      await actAs(tx, user.id)

      const { rows } = await tx.query<{ id: string }>(
        `insert into public.ads (title, format, status, points_reward, video_source,
                                 youtube_video_id, duration_seconds, min_watch_seconds, weight)
         values ('Celebration fixture', 'video', 'active', 100, 'youtube', 'dQw4w9WgXcQ', 30, 0, 100)
         returning id`,
      )
      await tx.query(
        `insert into public.user_ad_state (user_id, ad_id, status, completed_at)
         values ($1, $2, 'completed', now())`,
        [user.id, rows[0]!.id],
      )
      await tx.query(`select public.mark_onboarding_step('balance')`)
      await tx.query(`select public.mark_onboarding_step('statement')`)

      const s = await state(tx, user.id)
      expect(done(s, 'first_ad')).toBe(true)
      // The moment is still ahead of them, not silently spent.
      expect(s.currentStep).toBe('celebrate')
    })
  })

  /*
    ⚠️ PRESSING "SHOW ME AROUND" MUST NOT SPEND STEP ONE. The welcome sheet had
    no way to record that somebody had begun other than to mark a step, so it
    marked `balance`: the row appeared, which is what it wanted, and step one
    was consumed, which it did not. A real member pressed the button and landed
    on step TWO, never having been shown their own balance. It went unnoticed
    because the screenshot script seeded the row directly and never pressed it.
  */
  it('begins the walkthrough without spending the first step', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Show Me Around' })
      await actAs(tx, user.id)

      await tx.query(`select public.start_onboarding()`)
      const s = await state(tx, user.id)

      expect(s.started).toBe(true)
      expect(s.currentStep).toBe('balance')
      expect(s.doneCount).toBe(0)
    })
  })

  it('does not reset progress if the start is recorded twice', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Twice' })
      await actAs(tx, user.id)

      await tx.query(`select public.start_onboarding()`)
      await tx.query(`select public.mark_onboarding_step('balance')`)
      await tx.query(`select public.start_onboarding()`)

      const s = await state(tx, user.id)
      expect(done(s, 'balance')).toBe(true)
      expect(s.currentStep).toBe('statement')
    })
  })

  it('refuses a step nobody has heard of', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const user = await createUser(tx, { name: 'Made It Up' })
      await actAs(tx, user.id)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.mark_onboarding_step('become_admin')`),
      )
      expect(message).toMatch(/no such step/i)
    })
  })

  it('will not tell one member about another member\'s progress', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const nosy = await createUser(tx, { name: 'Nosy' })
      const other = await createUser(tx, { name: 'Other' })

      await actAs(tx, nosy.id)
      const message = await expectRejection(tx, () =>
        tx.query(`select public.get_onboarding_state($1)`, [other.id]),
      )
      expect(message).toMatch(/not allowed/i)
    })
  })

  /* An admin viewing somebody's screens must see THEIR walkthrough, for the
     same reason the games screen had to be fixed: a read that resolves its own
     subject from auth.uid() answers for the admin and looks plausible. */
  it('answers for the member an admin is viewing', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const member = await createUser(tx, { name: 'Being Viewed' })
      const admin = await createAdmin(tx)

      await actAs(tx, member.id)
      await tx.query(`select public.mark_onboarding_step('balance')`)

      await actAsAdmin(tx, admin.id)
      const theirs = await state(tx, member.id)
      const mine = await state(tx, admin.id)

      expect(done(theirs, 'balance')).toBe(true)
      expect(done(mine, 'balance')).toBe(false)
    })
  })

  it('lets the operator drop a step, and refuses a funnel with a hole in it', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'onboarding_enabled', 'true')
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Shorter Tour' })

      await tx.query(
        `select public.admin_save_onboarding_steps($1, $2::jsonb)`,
        [admin.id, JSON.stringify([{ key: 'games', sortOrder: 8, isEnabled: false }])],
      )

      await actAs(tx, user.id)
      const s = await state(tx, user.id)
      expect(s.steps.map((x) => x.key)).not.toContain('games')
      expect(s.total).toBe(9)

      /* Turning off the first ad while the celebration and the upgrade pitch
         are still on would leave the conversion sequence congratulating
         somebody on nothing. */
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_save_onboarding_steps($1, $2::jsonb)`, [
          admin.id,
          JSON.stringify([{ key: 'first_ad', sortOrder: 3, isEnabled: false }]),
        ]),
      )
      expect(message).toMatch(/nothing to celebrate/i)
    })
  })
})
