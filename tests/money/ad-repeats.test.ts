import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  balanceOf,
  createUser,
  expectRejection,
  pinEconomy,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * Repeating an ad when there is nothing else to show.
 *
 * Operator, 2026-08-01: *"ads must repeat if there are no different ads
 * available. failed ads must repeat if there are no new ads. as soon as we
 * start we are not going to have massive number of advertisers."*
 *
 * WHAT IS ACTUALLY AT RISK HERE. Until today, "one ad pays one person once"
 * was structurally true: the ledger's unique index made a second credit for
 * the same reference impossible to write. Repeats mean that sentence has to
 * change, and the whole danger is that it changes into nothing. It has not:
 * the reference now carries the OCCASION, so the guarantee narrows to "one
 * credit per completion" and every double-submit, retry and replay still
 * collides with the index. The tests below spend most of their effort on that
 * rather than on the feature.
 *
 * The second risk is the gate. A repeat is a FALLBACK — it opens only when the
 * person has nothing else — and if the feed and `register_ad_view` ever
 * disagreed about that, somebody could re-watch a favourite ad while fresh
 * ones sat unwatched. They ask the same function, and it is checked here from
 * both sides.
 */

/** An ad nobody has seen, live and payable. */
const newAd = async (tx: Tx, title: string, points = 50) => {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.ads (title, format, status, points_reward, video_source,
                             youtube_video_id, duration_seconds, min_watch_seconds, weight)
     values ($1, 'video', 'active', $2::bigint, 'youtube', 'dQw4w9WgXcQ', 30, 0, 100)
     returning id`,
    [title, points],
  )
  return rows[0]!.id
}

/** Watch it through and be paid, the way the application does it. */
const watch = async (tx: Tx, userId: string, adId: string) => {
  await tx.query(`select public.register_ad_view($1, $2)`, [userId, adId])
  // The watch clock is wall time from register_ad_view, and `now()` does not
  // move inside a transaction — so the stamp is backdated rather than waited on.
  await tx.query(
    `update public.user_ad_state set watch_started_at = now() - interval '60 seconds'
      where user_id = $1 and ad_id = $2`,
    [userId, adId],
  )
  const { rows } = await tx.query(`select * from public.submit_ad_answers($1, $2, '{}'::jsonb)`, [
    userId,
    adId,
  ])
  return rows[0]!
}

const feedSize = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query(`select count(*)::int n from public.get_ad_feed($1, null, 40)`, [
    userId,
  ])
  return rows[0]!.n as number
}

const ledgerRows = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query(
    `select reference_id, amount from public.points_ledger
      where user_id = $1 and reference_type = 'ad' order by created_at`,
    [userId],
  )
  return rows
}

/**
 * A user who can only ever see the ads this test made.
 *
 * The project has real ads in it, so a test that asks "have they run out?"
 * against the whole pool is asking about somebody else's data. Restricting
 * every OTHER ad to a tier this user does not hold makes the question local
 * again — and uses the targeting rules rather than working around them.
 */
const onlyTheseAds = async (tx: Tx, userId: string, keep: string[]) => {
  /* Repeats are about watching the SAME ad twice, which needs an allowance of
     more than one a day — and the free plan is on one since the pricing
     restructure. */
  await pinEconomy(tx)
  await tx.query(
    `insert into public.ad_tiers (ad_id, tier_id)
     select a.id, (select id from public.tiers where slug = 'platinum')
       from public.ads a
      where a.status = 'active' and a.id <> all($1::uuid[])
     on conflict do nothing`,
    [keep],
  )
  await tx.query(`update public.app_config set value = 'false' where key = 'ad_targeting_includes_lower_tiers'`)
  void userId
}

describe.skipIf(!HAS_DB)('repeating an ad once the pool is exhausted', () => {
  it('does not repeat while there is anything else to watch', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Has More' })
      const first = await newAd(tx, 'Repeat test — one')
      const second = await newAd(tx, 'Repeat test — two')
      await onlyTheseAds(tx, user.id, [first, second])

      expect(await feedSize(tx, user.id)).toBe(2)
      await watch(tx, user.id, first)

      // One left, so the finished one must NOT come back yet.
      expect(await feedSize(tx, user.id)).toBe(1)
      const { rows } = await tx.query(`select public.may_repeat_ads($1) as may`, [user.id])
      expect(rows[0]!.may).toBe(false)
    })
  })

  it('offers the finished ones again once nothing is left', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Ran Out' })
      const only = await newAd(tx, 'Repeat test — only')
      await onlyTheseAds(tx, user.id, [only])

      await watch(tx, user.id, only)
      expect(await feedSize(tx, user.id)).toBe(1)

      const { rows } = await tx.query(`select public.may_repeat_ads($1) as may`, [user.id])
      expect(rows[0]!.may).toBe(true)
    })
  })

  it('pays for the repeat, and books it against a different occasion', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Paid Twice' })
      const only = await newAd(tx, 'Repeat test — pays again', 50)
      await onlyTheseAds(tx, user.id, [only])

      expect((await watch(tx, user.id, only)).outcome).toBe('correct')
      expect((await watch(tx, user.id, only)).outcome).toBe('correct')

      expect(await balanceOf(tx, user.id)).toBe(100)

      /* The first completion keeps the bare ad id every historical row has;
         the second carries the occasion. That is what lets the unique index
         keep working while the same ad pays a second time.

         Compared as a SET, not in order: both rows are written inside one
         transaction, so `created_at` is identical on both and any ordering by
         it is arbitrary. */
      const rows = await ledgerRows(tx, user.id)
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.reference_id).sort()).toEqual([only, `${only}#2`].sort())

      const { rows: state } = await tx.query(
        `select times_completed from public.user_ad_state where user_id = $1 and ad_id = $2`,
        [user.id, only],
      )
      expect(state[0]!.times_completed).toBe(2)
    })
  })

  it('still cannot pay the same occasion twice', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Replay' })
      const only = await newAd(tx, 'Repeat test — replay', 50)
      await onlyTheseAds(tx, user.id, [only])

      await watch(tx, user.id, only)

      /* A replayed submit for a completion that has already been paid: the
         state row is put back to a fresh attempt by hand, WITHOUT bumping the
         occasion, which is exactly what a crash between the credit and the
         state update would leave behind. The ledger index is what has to
         catch it. */
      await tx.query(
        `update public.user_ad_state
            set status = 'in_progress', times_completed = 0,
                watch_started_at = now() - interval '60 seconds'
          where user_id = $1 and ad_id = $2`,
        [user.id, only],
      )
      const { rows } = await tx.query(`select * from public.submit_ad_answers($1, $2, '{}'::jsonb)`, [
        user.id,
        only,
      ])

      expect(rows[0]!.outcome).toBe('already_completed')
      expect(await balanceOf(tx, user.id)).toBe(50)
      expect(await ledgerRows(tx, user.id)).toHaveLength(1)

      // And the counter is put back in step, so the NEXT repeat is not stuck
      // trying to reuse a reference that already exists.
      const { rows: state } = await tx.query(
        `select times_completed from public.user_ad_state where user_id = $1 and ad_id = $2`,
        [user.id, only],
      )
      expect(state[0]!.times_completed).toBe(1)
    })
  })

  it('brings back an ad the user failed out of, with its tries reset', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Locked Out' })
      const only = await newAd(tx, 'Repeat test — failed')
      await onlyTheseAds(tx, user.id, [only])

      await tx.query(
        `insert into public.user_ad_state (user_id, ad_id, status, attempts_used, locked_at, updated_at)
         values ($1, $2, 'failed_locked', 3, now(), now())`,
        [user.id, only],
      )
      expect(await feedSize(tx, user.id)).toBe(1)

      const { rows } = await tx.query(
        `select attempts_used, attempts_remaining from public.get_ad_feed($1, null, 40)`,
        [user.id],
      )
      expect(rows[0]!.attempts_used).toBe(0)
      expect(Number(rows[0]!.attempts_remaining)).toBeGreaterThan(0)

      // And it can actually be watched again, rather than being offered and refused.
      expect((await watch(tx, user.id, only)).outcome).toBe('correct')
    })
  })

  it('refuses to re-open a finished ad while fresh ones exist', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Cherry Picker' })
      const first = await newAd(tx, 'Repeat test — cherry one')
      const second = await newAd(tx, 'Repeat test — cherry two')
      await onlyTheseAds(tx, user.id, [first, second])

      await watch(tx, user.id, first)

      /* The hole this closes: the feed would never offer `first` again while
         `second` is unwatched, but a client that remembered the id could ask
         to start it anyway. register_ad_view asks the same question the feed
         asked. */
      const message = await expectRejection(tx, () =>
        tx.query(`select public.register_ad_view($1, $2)`, [user.id, first]),
      )
      expect(message).toMatch(/closed for this user/i)
      expect(await balanceOf(tx, user.id)).toBe(50)
    })
  })

  it('can be switched off, and then the feed simply empties', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'No Repeats' })
      const only = await newAd(tx, 'Repeat test — switch off')
      await onlyTheseAds(tx, user.id, [only])

      await watch(tx, user.id, only)
      expect(await feedSize(tx, user.id)).toBe(1)

      await setConfig(tx, 'ad_repeat_when_exhausted', 'false')
      expect(await feedSize(tx, user.id)).toBe(0)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.register_ad_view($1, $2)`, [user.id, only]),
      )
      expect(message).toMatch(/closed for this user/i)
    })
  })

  it('honours a minimum gap between repeats when one is set', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Too Soon' })
      const only = await newAd(tx, 'Repeat test — gap')
      await onlyTheseAds(tx, user.id, [only])

      await watch(tx, user.id, only)
      await setConfig(tx, 'ad_repeat_min_hours', '6')

      expect(await feedSize(tx, user.id)).toBe(0)
      const message = await expectRejection(tx, () =>
        tx.query(`select public.register_ad_view($1, $2)`, [user.id, only]),
      )
      expect(message).toMatch(/watched again later/i)

      // Once the gap has passed it comes back.
      await tx.query(
        `update public.user_ad_state set completed_at = now() - interval '7 hours'
          where user_id = $1 and ad_id = $2`,
        [user.id, only],
      )
      expect(await feedSize(tx, user.id)).toBe(1)
    })
  })

  it("still stops at the advertiser's budget", async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Budget' })
      const only = await newAd(tx, 'Repeat test — budget')
      await onlyTheseAds(tx, user.id, [only])
      await tx.query(`update public.ads set max_completions = 1 where id = $1`, [only])

      expect((await watch(tx, user.id, only)).outcome).toBe('correct')

      /* The budget is the advertiser's, and a repeat spends it like any other
         completion — so a one-completion ad is finished for everybody, not
         merely for this person. */
      expect(await feedSize(tx, user.id)).toBe(0)
      const message = await expectRejection(tx, () =>
        tx.query(`select public.register_ad_view($1, $2)`, [user.id, only]),
      )
      expect(message).toMatch(/not available/i)
    })
  })
})
