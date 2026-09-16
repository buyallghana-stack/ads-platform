import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type LadderRung,
  PINNED_LADDER,
  type Tx,
  createUser,
  pinLadder,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * A stacked plan brings its own ads AND its own rate.
 *
 * Operator, 2026-08-12: *"the ads of the manager adds up to a total of 24
 * rather than the 27 providing he has bought all plans, and i noticed that you
 * value all the existing 24 ads at 700 points which is wrong. there are many
 * plans stacked together and each get their respective value points per ad.
 * you nearly cost me money."*
 *
 * WHAT WAS WRONG, AND WHY NO TEST CAUGHT IT. `resolve_user_tier` summed the
 * money across every active subscription and resolved ONE multiplier from the
 * total, so four plans bought a top rate that then applied to every ad of the
 * day. The daily-limit tests asserted the CAP and the band tests asserted the
 * RATE FOR ONE PAYMENT; nothing asserted what a stacked account earns across a
 * whole day, which is the only place the two rules meet. That gap is what
 * these tests close, and it is why the last one watches real ads rather than
 * asking a function.
 *
 * THE ORDER IS PART OF THE RULE. Allowances are consumed best first, so
 * somebody who watches five ads gets their five best. It is also the only
 * order in which the rate the feed advertises is the rate the next ad pays.
 */

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

const allowances = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ slug: string; ads: number; multiplier: string }>(
    `select slug, ads, multiplier::text from public.user_ad_allowances($1) order by slot`,
    [userId],
  )
  return rows.map((r) => ({ slug: r.slug, ads: r.ads, multiplier: Number(r.multiplier) }))
}

/** What the next ad pays, `done` ads into the day. */
const rewardAt = async (tx: Tx, userId: string, base: number, done: number) => {
  const { rows } = await tx.query<{ p: string }>(
    `select public.ad_reward_points($1, $2::bigint, $3::int) as p`,
    [userId, base, done],
  )
  return Number(rows[0]!.p)
}

const cap = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ cap: number }>(
    `select (public.resolve_user_tier($1)).daily_ad_cap as cap`,
    [userId],
  )
  return rows[0]!.cap
}

/* The four purchasable rungs at their floor prices: the cheapest way to hold
   everything, and the prices at which each rung pays exactly its own listed
   multiplier rather than something part way up a band. */
const PAID = PINNED_LADDER.filter((r) => r.priceGhs > 0 && r.slug !== 'diamond')

describe.skipIf(!HAS_DB)('what a stacked day is worth', () => {
  it('lists one allowance per plan, best rate first', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'All Four' })
      for (const rung of PAID) await buy(tx, user.id, rung.slug, rung.priceGhs)

      /* Descending by rate, which is the order they are spent in. Derived from
         the ladder rather than typed out, so a reordered ladder cannot leave
         this passing against yesterday's list. */
      expect(await allowances(tx, user.id)).toEqual(
        [...PAID]
          .sort((a, b) => b.multiplier - a.multiplier)
          .map((r) => ({ slug: r.slug, ads: r.dailyAdCap, multiplier: r.multiplier })),
      )
    })
  })

  it('pays each ad at the rate of the plan whose allowance it comes out of', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'Four Rates' })
      for (const rung of PAID) await buy(tx, user.id, rung.slug, rung.priceGhs)

      /* The whole day, ad by ad, against the slices the ladder implies. On the
         pinned ladder that is 13 at ×3, then 7 at ×2.5, then 4 at ×2, then 3
         at ×1.5 — and the 14th ad dropping from 300 to 250 is the entire
         point of the migration. */
      const expected = [...PAID]
        .sort((a, b) => b.multiplier - a.multiplier)
        .flatMap((r) => Array(r.dailyAdCap).fill(Math.floor(100 * r.multiplier)) as number[])

      const actual: number[] = []
      for (let done = 0; done < expected.length; done += 1) {
        actual.push(await rewardAt(tx, user.id, 100, done))
      }

      expect(actual).toEqual(expected)
    })
  })

  it('is worth less than the top rate across the whole cap, which is the bug', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'The Difference' })
      for (const rung of PAID) await buy(tx, user.id, rung.slug, rung.priceGhs)

      const ads = await cap(tx, user.id)
      let day = 0
      for (let done = 0; done < ads; done += 1) day += await rewardAt(tx, user.id, 100, done)

      const top = Math.max(...PAID.map((r) => r.multiplier))
      const wasPaying = ads * Math.floor(100 * top)

      expect(ads).toBe(PAID.reduce((sum, r) => sum + r.dailyAdCap, 0))
      expect(day).toBe(
        PAID.reduce((sum, r) => sum + r.dailyAdCap * Math.floor(100 * r.multiplier), 0),
      )
      // Every ad at the top rate is what the old rule paid, and it is more.
      expect(day).toBeLessThan(wasPaying)
    })
  })

  it('leaves one plan exactly where it was', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const platinum = PINNED_LADDER.find((r) => r.slug === 'platinum')!
      const user = await createUser(tx, { name: 'Just Platinum' })
      await buy(tx, user.id, 'platinum', platinum.priceGhs)

      expect(await cap(tx, user.id)).toBe(platinum.dailyAdCap)
      for (const done of [0, platinum.dailyAdCap - 1]) {
        expect(await rewardAt(tx, user.id, 100, done)).toBe(Math.floor(100 * platinum.multiplier))
      }
    })
  })

  it('leaves somebody with no plan at all on the free allowance', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const free = PINNED_LADDER.find((r) => r.priceGhs === 0)!
      const user = await createUser(tx, { name: 'No Plan' })

      expect(await allowances(tx, user.id)).toEqual([
        { slug: free.slug, ads: free.dailyAdCap, multiplier: free.multiplier },
      ])
      expect(await rewardAt(tx, user.id, 100, 0)).toBe(Math.floor(100 * free.multiplier))
    })
  })

  it('falls back to one allowance when stacking is switched off', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await setConfig(tx, 'subscription_stacking_enabled', 'false')
      const user = await createUser(tx, { name: 'No Stacking' })
      for (const rung of PAID) await buy(tx, user.id, rung.slug, rung.priceGhs)

      const rows = await allowances(tx, user.id)
      const platinum = PINNED_LADDER.find((r) => r.slug === 'platinum')!
      expect(rows).toEqual([
        { slug: 'platinum', ads: platinum.dailyAdCap, multiplier: platinum.multiplier },
      ])
    })
  })

  /* ⚠️ THE ONE THAT WOULD HAVE CAUGHT THE BUG. Everything above asks a
     function what an ad is worth; this watches ads through
     `register_ad_view` → `submit_ad_answers` and reads what was actually
     credited. The rate has to come off the counter of ads finished today, and
     that counter is written by `credit_points` — so a valuation read after the
     credit rather than before it would pass every test above and pay the wrong
     rate here. */
  it('credits the slice rate through the real watching path', async () => {
    await withRollback(async (tx) => {
      /* A compact ladder: two plans, two ads each. The rule is the same at
         four ads as at twenty-seven, and twenty-seven round trips per watch is
         a minute of latency to a database in Paris. */
      const compact: LadderRung[] = [
        { slug: 'free', name: 'Free', priceGhs: 0, multiplier: 1.0, dailyAdCap: 1 },
        { slug: 'bronze', name: 'Bronze', priceGhs: 65, multiplier: 1.5, dailyAdCap: 2 },
        { slug: 'silver', name: 'Silver', priceGhs: 140, multiplier: 2.0, dailyAdCap: 2 },
      ]
      await pinLadder(tx, { rungs: compact })

      const user = await createUser(tx, { name: 'Watches Four' })
      await buy(tx, user.id, 'bronze', 65)
      await buy(tx, user.id, 'silver', 140)

      expect(await cap(tx, user.id)).toBe(4)

      const paid: number[] = []
      for (let i = 0; i < 4; i += 1) {
        const { rows: ad } = await tx.query<{ id: string }>(
          `insert into public.ads (title, format, status, points_reward, video_source,
                                   youtube_video_id, duration_seconds, min_watch_seconds, weight)
           values ($1, 'video', 'active', 100, 'youtube', 'dQw4w9WgXcQ', 30, 0, 100)
           returning id`,
          [`Slice ad ${i + 1}`],
        )
        const adId = ad[0]!.id

        await tx.query(`select public.register_ad_view($1, $2)`, [user.id, adId])
        /* `now()` does not move inside a transaction, so the watch clock is
           backdated rather than waited on. */
        await tx.query(
          `update public.user_ad_state set watch_started_at = now() - interval '60 seconds'
            where user_id = $1 and ad_id = $2`,
          [user.id, adId],
        )
        const { rows } = await tx.query<{ points_awarded: string }>(
          `select * from public.submit_ad_answers($1, $2, '{}'::jsonb)`,
          [user.id, adId],
        )
        paid.push(Number(rows[0]!.points_awarded))
      }

      // Silver's two ads first at ×2, then Bronze's two at ×1.5.
      expect(paid).toEqual([200, 200, 150, 150])

      /* And the ledger says the same thing, with the rate this ad was paid at
         on the entry rather than the account's headline rate. */
      const { rows: ledger } = await tx.query<{ amount: string; m: string }>(
        `select amount::text, (metadata ->> 'ad_multiplier') as m
           from public.points_ledger
          where user_id = $1 and entry_type = 'ad_view'
          order by created_at, id`,
        [user.id],
      )
      expect(ledger.map((r) => Number(r.amount))).toEqual([200, 200, 150, 150])
      expect(ledger.map((r) => Number(r.m))).toEqual([2, 2, 1.5, 1.5])
    })
  })
})

describe.skipIf(!HAS_DB)('what one ad is worth', () => {
  /**
   * Operator, 2026-08-12: *"dont let me decide what a point is worth by an ad.
   * use what is already promised on the plan."*
   *
   * What an ad paid used to be the product of two numbers set in different
   * places: the ad's own `points_reward` and the plan's multiplier. The pool
   * held ads at 30, 40, 80 and 100, so a Platinum member on a 30-point ad was
   * paid less than a Bronze member on a 100-point one — the ladder promised
   * one thing and the feed did another.
   */
  /*
    `bucket` is not decoration. Since strict plan matching shipped, the feed
    shows a user only the ads tagged to a plan they actually HOLD, and
    `user_target_tiers` gives a paid subscriber their own plan alone: the
    default tier is the fallback for somebody holding nothing, not a floor
    everyone inherits. An untagged ad therefore reaches nobody who has paid,
    and a test asking what one ad is worth has to put it in the buyer's bucket
    first or it reads an empty feed and fails on `rows[0]` being undefined.
  */
  const anAd = async (tx: Tx, points: number, bucket?: string) => {
    const { rows } = await tx.query<{ id: string; points_reward: string }>(
      `insert into public.ads (title, format, status, points_reward, video_source,
                               youtube_video_id, duration_seconds, min_watch_seconds, weight)
       values ('Base fixture', 'video', 'active', $1::bigint, 'youtube',
               'dQw4w9WgXcQ', 30, 0, 100)
       returning id, points_reward::text`,
      [points],
    )
    const ad = rows[0]!
    if (bucket) {
      await tx.query(
        `insert into public.ad_tiers (ad_id, tier_id)
         select $1::uuid, t.id from public.tiers t where t.slug = $2`,
        [ad.id, bucket],
      )
    }
    return ad
  }

  it('ignores what the ad says and pays the platform base', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'Base Only' })
      await buy(tx, user.id, 'platinum', PINNED_LADDER.find((r) => r.slug === 'platinum')!.priceGhs)

      /* Asked for 30. The trigger overwrites it, and even if it had not, the
         feed and the credit no longer read the column. */
      const ad = await anAd(tx, 30, 'platinum')
      const { rows } = await tx.query<{ points_award: string }>(
        `select points_award::text from public.get_ad_feed($1, null, 50) where id = $2`,
        [user.id, ad.id],
      )

      const base = Number(
        (await tx.query<{ b: string }>(`select public.base_ad_points()::text as b`)).rows[0]!.b,
      )
      const platinum = PINNED_LADDER.find((r) => r.slug === 'platinum')!
      expect(Number(rows[0]!.points_award)).toBe(Math.floor(base * platinum.multiplier))
    })
  })

  it('keeps the column in step, so a row cannot claim a price nobody pays', async () => {
    await withRollback(async (tx) => {
      const ad = await anAd(tx, 4321)
      const base = (await tx.query<{ b: string }>(`select public.base_ad_points()::text as b`)).rows[0]!.b
      expect(ad.points_reward).toBe(base)
    })
  })

  it('moves every plan at once when the base moves', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const user = await createUser(tx, { name: 'After The Change' })
      await buy(tx, user.id, 'bronze', PINNED_LADDER.find((r) => r.slug === 'bronze')!.priceGhs)
      const bronze = PINNED_LADDER.find((r) => r.slug === 'bronze')!

      await setConfig(tx, 'base_ad_points', '250')
      const ad = await anAd(tx, 100, 'bronze')

      const { rows } = await tx.query<{ points_award: string }>(
        `select points_award::text from public.get_ad_feed($1, null, 50) where id = $2`,
        [user.id, ad.id],
      )
      expect(Number(rows[0]!.points_award)).toBe(Math.floor(250 * bronze.multiplier))
    })
  })
})
