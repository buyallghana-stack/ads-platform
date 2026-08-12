import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  createUser,
  expectRejection,
  pinLadder,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * A bucket per plan, and an ad that is not paid twice in one day.
 *
 * Operator, 2026-08-12: *"each band tier … has their own ads bucket"*, and
 * separately *"i was able to watch articles for several times abandoning the
 * video and survey"*. The two are one feature: buckets only mean anything if a
 * thin bucket cannot be farmed by repeating its one ad.
 *
 * ── WHAT WENT WRONG, AND WHAT NO TEST WAS WATCHING ──
 *
 * `ad_repeat_min_hours` was 0, so a finished ad returned to the feed instantly.
 * The single link ad reached `times_completed = 17` in a day. There were tests
 * for repeats EXISTING (migration 096) and none for repeats being LIMITED,
 * because the limit was a config value nobody had set.
 *
 * The targeting half had the opposite problem: `ad_tiers` and
 * `ad_targeting_includes_lower_tiers` have existed since the pool was built and
 * had 1 row against 11 live ads. Untested because unused.
 */

const newAd = async (
  tx: Tx,
  title: string,
  options: { points?: number; tierSlugs?: string[] } = {},
) => {
  const { points = 100, tierSlugs = [] } = options
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.ads (title, format, status, points_reward, video_source,
                             youtube_video_id, duration_seconds, min_watch_seconds, weight)
     values ($1, 'video', 'active', $2::bigint, 'youtube', 'dQw4w9WgXcQ', 30, 0, 100)
     returning id`,
    [title, points],
  )
  const id = rows[0]!.id
  for (const slug of tierSlugs) {
    await tx.query(
      `insert into public.ad_tiers (ad_id, tier_id)
       select $1, t.id from public.tiers t where t.slug = $2`,
      [id, slug],
    )
  }
  return id
}

const watch = async (tx: Tx, userId: string, adId: string) => {
  await tx.query(`select public.register_ad_view($1, $2)`, [userId, adId])
  await tx.query(
    `update public.user_ad_state set watch_started_at = now() - interval '60 seconds'
      where user_id = $1 and ad_id = $2`,
    [userId, adId],
  )
  const { rows } = await tx.query<{ outcome: string; points_awarded: string }>(
    `select * from public.submit_ad_answers($1, $2, '{}'::jsonb)`,
    [userId, adId],
  )
  return rows[0]!
}

const feedIds = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.get_ad_feed($1, null, 50)`,
    [userId],
  )
  return rows.map((r) => r.id)
}

/**
 * A user who can only ever see the ads this test made.
 *
 * The project has eleven real ads in it, so "have they run out?" asked against
 * the whole pool is a question about somebody else's data — and until they run
 * out, the repeat path never opens at all. Tagging every OTHER ad to a plan
 * this user does not hold makes the question local, and does it through the
 * targeting rules rather than around them. Borrowed from ad-repeats.test.ts,
 * where the same problem was solved the same way.
 */
const onlyTheseAds = async (tx: Tx, keep: string[]) => {
  await tx.query(
    `insert into public.ad_tiers (ad_id, tier_id)
     select a.id, (select id from public.tiers where slug = 'platinum')
       from public.ads a
      where a.status = 'active' and a.id <> all($1::uuid[])
     on conflict do nothing`,
    [keep],
  )
}

const buy = async (tx: Tx, userId: string, slug: string, ghs: number) => {
  const { rows: tier } = await tx.query<{ id: string }>(
    `select id from public.tiers where slug = $1`,
    [slug],
  )
  const { rows } = await tx.query<{ id: string }>(
    `select * from public.start_subscription_payment($1, $2, 'paystack', $3::bigint)`,
    [userId, tier[0]!.id, Math.round(ghs * 100)],
  )
  await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
    rows[0]!.id,
    `TEST-${rows[0]!.id}`,
  ])
}

describe.skipIf(!HAS_DB)('a bucket per plan', () => {
  it('shows a plan its own bucket and not the one above it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const bronzeAd = await newAd(tx, 'Bronze bucket', { tierSlugs: ['bronze'] })
      const goldAd = await newAd(tx, 'Gold bucket', { tierSlugs: ['gold'] })

      const bronze = await createUser(tx, { name: 'Bronze Only' })
      await buy(tx, bronze.id, 'bronze', 65)

      const seen = await feedIds(tx, bronze.id)
      expect(seen).toContain(bronzeAd)
      expect(seen).not.toContain(goldAd)
    })
  })

  it('does not show a higher plan the buckets below it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const bronzeAd = await newAd(tx, 'Bronze bucket', { tierSlugs: ['bronze'] })
      const goldAd = await newAd(tx, 'Gold bucket', { tierSlugs: ['gold'] })

      /* The operator chose exclusive on 2026-08-12, against the alternative of
         "this plan and every plan above". Gold sees Gold and nothing else. */
      const gold = await createUser(tx, { name: 'Gold Only' })
      await buy(tx, gold.id, 'gold', 250)

      const seen = await feedIds(tx, gold.id)
      expect(seen).toContain(goldAd)
      expect(seen).not.toContain(bronzeAd)
    })
  })

  it('gives somebody holding two plans both buckets', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const bronzeAd = await newAd(tx, 'Bronze bucket', { tierSlugs: ['bronze'] })
      const goldAd = await newAd(tx, 'Gold bucket', { tierSlugs: ['gold'] })

      const both = await createUser(tx, { name: 'Bronze And Gold' })
      await buy(tx, both.id, 'bronze', 65)
      await buy(tx, both.id, 'gold', 250)

      const seen = await feedIds(tx, both.id)
      expect(seen).toContain(bronzeAd)
      expect(seen).toContain(goldAd)
    })
  })

  it('still shows an untagged ad to everybody', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      /* The eleven ads live on 2026-08-12 carry no tag, and turning targeting
         exclusive must not make them disappear from every feed at once. */
      const houseAd = await newAd(tx, 'No bucket at all')

      const free = await createUser(tx, { name: 'No Plan' })
      const gold = await createUser(tx, { name: 'Gold' })
      await buy(tx, gold.id, 'gold', 250)

      expect(await feedIds(tx, free.id)).toContain(houseAd)
      expect(await feedIds(tx, gold.id)).toContain(houseAd)
    })
  })
})

describe.skipIf(!HAS_DB)('an ad is not paid twice in one day', () => {
  it('does not offer an ad again on the day it was finished', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const only = await newAd(tx, 'The only ad')
      await onlyTheseAds(tx, [only])
      const user = await createUser(tx, { name: 'Watches Twice' })

      expect((await watch(tx, user.id, only)).outcome).toBe('correct')

      /* The exact shape of the operator's report: one ad, watched again
         immediately, seventeen times over. The feed is empty now and the
         person is caught up rather than farming. */
      expect(await feedIds(tx, user.id)).not.toContain(only)
    })
  })

  it('refuses the watch itself, not just the listing', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const only = await newAd(tx, 'The only ad')
      await onlyTheseAds(tx, [only])
      const user = await createUser(tx, { name: 'Taps Anyway' })
      await watch(tx, user.id, only)

      /* ⚠️ THE HALF THAT MATTERS. Hiding an ad from the feed is a suggestion;
         `register_ad_view` is the rule. If these two ever disagree, anybody who
         reaches the ad another way is still paid. */
      const message = await expectRejection(tx, () =>
        tx.query(`select public.register_ad_view($1, $2)`, [user.id, only]),
      )
      expect(message).toMatch(/again tomorrow/i)
    })
  })

  it('offers it again once the day has turned', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const only = await newAd(tx, 'Yesterday')
      await onlyTheseAds(tx, [only])
      const user = await createUser(tx, { name: 'Comes Back' })
      await watch(tx, user.id, only)

      /* Backdated rather than waited for: `now()` does not move inside a
         transaction. This is the operator's "it only repeats if i forgot to
         add different ads the next day". */
      await tx.query(
        `update public.user_ad_state
            set completed_at = now() - interval '30 hours',
                updated_at   = now() - interval '30 hours'
          where user_id = $1 and ad_id = $2`,
        [user.id, only],
      )

      expect(await feedIds(tx, user.id)).toContain(only)
    })
  })

  it('lets the operator turn same-day repeats back on', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'ad_repeat_same_day', 'true')
      const only = await newAd(tx, 'The only ad')
      await onlyTheseAds(tx, [only])
      const user = await createUser(tx, { name: 'Old Behaviour' })
      await watch(tx, user.id, only)

      expect(await feedIds(tx, user.id)).toContain(only)
    })
  })

  it('still honours a longer cool-off on top of the day rule', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'ad_repeat_min_hours', '48')
      const only = await newAd(tx, 'Slow burn')
      await onlyTheseAds(tx, [only])
      const user = await createUser(tx, { name: 'Two Days' })
      await watch(tx, user.id, only)

      // Yesterday clears the day rule but not a 48 hour cool-off.
      await tx.query(
        `update public.user_ad_state
            set completed_at = now() - interval '30 hours',
                updated_at   = now() - interval '30 hours'
          where user_id = $1 and ad_id = $2`,
        [user.id, only],
      )
      expect(await feedIds(tx, user.id)).not.toContain(only)
    })
  })
})
