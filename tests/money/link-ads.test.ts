import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  balanceOf,
  createUser,
  expectRejection,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * Link ads: an article, a reading time, and one link that pays when tapped.
 *
 * WHAT THESE TESTS ARE REALLY FOR. This format asks for one tap, and nobody
 * can observe whether the article was read or what happens after the click.
 * Everything standing between it and a button that prints points is here:
 * the reading time, one payment per person per ad for all time, and the caps
 * that apply to every format. So the tests are written as the ways somebody
 * would try to get paid twice or paid early, not as a tour of the happy path.
 *
 * The other half of the file is the SHAPE. Migration 090 rewrote
 * `ads_video_shape` because its CASE ended in `else null` — and a CHECK that
 * evaluates to NULL passes, so the new format would have been accepted with no
 * rules at all. That is exactly the kind of hole that is invisible until a
 * malformed ad is already serving, so each branch of the rewritten constraint
 * gets a test that proves a refusal.
 *
 * TIME INSIDE A TRANSACTION IS A TRAP HERE. `submit_ad_answers` measures the
 * read as `now() - watch_started_at`, and `now()` is the TRANSACTION's clock
 * while `register_ad_view` stamps `clock_timestamp()` — so inside one
 * transaction the stamp is in the future and the elapsed time is negative. A
 * test that "waited" would be testing nothing. Every test below backdates the
 * stamp explicitly, which is also the only way to express "they read for 60
 * seconds" without sleeping for 60 seconds.
 */

type Outcome = {
  outcome: string
  points_awarded: string | number
  attempts_used: number
  attempts_remaining: number
  new_balance: string | number | null
  message: string | null
}

/** A live link ad, made the way the editor makes one. */
async function newLinkAd(
  tx: Tx,
  options: { points?: number; dwell?: number; article?: string; status?: string } = {},
): Promise<string> {
  const {
    points = 25,
    dwell = 15,
    article = 'A piece the reader is asked to read before the link, long enough to be legal.',
    status = 'active',
  } = options

  const { rows } = await tx.query<{ id: string }>(
    `insert into public.ads
       (title, description, advertiser_name, format, status, points_reward,
        min_watch_seconds, article_body, cta_links, cta_label, weight)
     values ('A link ad', 'Read this', 'Test Advertiser', 'link', $1::public.ad_status, $2::bigint,
             $3::int, $4, '[{"kind":"website","value":"example.com"}]'::jsonb, 'Visit', 100)
     returning id`,
    [status, points, dwell, article],
  )
  const id = rows[0]!.id
  /* ⚠️ Tagged to `free`, and it has to be. Since strict plan matching
     (20260866000000) the feed only carries ads explicitly tagged to a bucket
     the reader holds, so an untagged fixture is invisible and every assertion
     about what the feed sends would pass against an empty list. */
  await tx.query(
    `insert into public.ad_tiers (ad_id, tier_id)
     select $1::uuid, t.id from public.tiers t where t.slug = 'free'`,
    [id],
  )
  return id
}

/**
 * Somebody who opened the article `secondsAgo` ago.
 *
 * `register_ad_view` first, so the row is created by the same function the
 * application uses — then the stamp is moved back, which is the only way to
 * express reading time in a transaction whose clock does not move.
 */
async function openedArticle(tx: Tx, userId: string, adId: string, secondsAgo: number) {
  await tx.query(`select public.register_ad_view($1, $2)`, [userId, adId])
  await tx.query(
    `update public.user_ad_state
        set watch_started_at = now() - make_interval(secs => $3::int)
      where user_id = $1 and ad_id = $2`,
    [userId, adId, secondsAgo],
  )
}

/**
 * One tap on the link.
 *
 * `select * from f(...)` rather than `select f(...) as r`: the driver hands a
 * composite back as the raw literal `(correct,25,…)` and every field reads
 * undefined, so a test written the second way asserts against nothing and
 * fails for the wrong reason. And NEVER `select (f(...)).*` — that form
 * evaluates the function once PER COLUMN, which on a function that credits
 * points means crediting them six times.
 */
const click = async (tx: Tx, userId: string, adId: string): Promise<Outcome> => {
  const { rows } = await tx.query<Outcome>(
    `select * from public.record_ad_link_click($1, $2)`,
    [userId, adId],
  )
  return rows[0]!
}

const clickRows = async (tx: Tx, adId: string) => {
  const { rows } = await tx.query(
    `select * from public.ad_link_clicks where ad_id = $1 order by clicked_at`,
    [adId],
  )
  return rows
}

/**
 * What one ad pays this person right now.
 *
 * ⚠️ ASKED, NOT ASSUMED (migration 192). These tests used to make an ad worth
 * 25 points and expect 25, because an ad carried its own price. Operator,
 * 2026-08-12: it does not any more — every ad pays the platform base and the
 * plan does the rest — so `points` on the fixture is now decoration and a
 * hardcoded 25 here would assert the rule that was removed. The `dwell` on
 * these fixtures still matters: the reading time is the whole defence of this
 * format.
 */
const worth = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ p: string }>(
    `select public.ad_reward_points($1, public.base_ad_points(), 0)::text as p`,
    [userId],
  )
  return Number(rows[0]!.p)
}

describe.skipIf(!HAS_DB)('link ads', () => {
  it('pays once the reading time has run, and records the visit', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Reader' })
      const ad = await newLinkAd(tx, { points: 25, dwell: 15 })
      await openedArticle(tx, user.id, ad, 60)

      const result = await click(tx, user.id, ad)

      expect(result.outcome).toBe('correct')
      const paid = await worth(tx, user.id)
      expect(Number(result.points_awarded)).toBe(paid)
      expect(await balanceOf(tx, user.id)).toBe(paid)

      // The visit is its own record, and it carries what the click was worth
      // — the number an advertiser is invoiced against, frozen against a
      // later change to the ad's reward.
      const clicks = await clickRows(tx, ad)
      expect(clicks).toHaveLength(1)
      expect(clicks[0]!.user_id).toBe(user.id)
      expect(Number(clicks[0]!.points_awarded)).toBe(paid)

      const { rows: ledger } = await tx.query(
        `select entry_type, amount from public.points_ledger where user_id = $1`,
        [user.id],
      )
      expect(ledger).toHaveLength(1)
      expect(Number(ledger[0]!.amount)).toBe(paid)
    })
  })

  it('refuses a click before the reading time, and pays nothing for it', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Too Quick' })
      const ad = await newLinkAd(tx, { points: 40, dwell: 30 })
      await openedArticle(tx, user.id, ad, 2)

      const result = await click(tx, user.id, ad)

      expect(result.outcome).toBe('too_fast')
      expect(Number(result.points_awarded)).toBe(0)
      expect(await balanceOf(tx, user.id)).toBe(0)

      // The visit still happened — the advertiser got their traffic — but it
      // was worth nothing, and that is what the row says.
      const clicks = await clickRows(tx, ad)
      expect(clicks).toHaveLength(1)
      expect(Number(clicks[0]!.points_awarded)).toBe(0)
    })
  })

  it('pays a person once for an ad, however many times they tap the link', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Twice' })
      const ad = await newLinkAd(tx, { points: 30, dwell: 5 })
      await openedArticle(tx, user.id, ad, 60)

      expect((await click(tx, user.id, ad)).outcome).toBe('correct')

      const second = await click(tx, user.id, ad)
      expect(second.outcome).toBe('already_completed')
      expect(Number(second.points_awarded)).toBe(0)

      // Still one balance, one ledger row, and ONE click row — the unique
      // constraint means a second visit is unrepresentable rather than merely
      // refused, and the row keeps what the paying click was worth.
      const paid = await worth(tx, user.id)
      expect(await balanceOf(tx, user.id)).toBe(paid)
      const clicks = await clickRows(tx, ad)
      expect(clicks).toHaveLength(1)
      expect(Number(clicks[0]!.points_awarded)).toBe(paid)
    })
  })

  it('records the early visit and still pays when they come back and read it', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Came Back' })
      const ad = await newLinkAd(tx, { points: 20, dwell: 20 })

      await openedArticle(tx, user.id, ad, 1)
      expect((await click(tx, user.id, ad)).outcome).toBe('too_fast')

      // Reopening restarts the clock, exactly as the reader does.
      await openedArticle(tx, user.id, ad, 45)
      const second = await click(tx, user.id, ad)

      expect(second.outcome).toBe('correct')
      const paid = await worth(tx, user.id)
      expect(await balanceOf(tx, user.id)).toBe(paid)
      // The same row, updated to what it ended up being worth — not a second
      // visit, because it is the same person on the same ad.
      const clicks = await clickRows(tx, ad)
      expect(clicks).toHaveLength(1)
      expect(Number(clicks[0]!.points_awarded)).toBe(paid)
    })
  })

  it('is stopped by the platform-wide earning pause, and credits nothing', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Paused' })
      const ad = await newLinkAd(tx, { points: 25, dwell: 5 })
      await openedArticle(tx, user.id, ad, 60)

      await setConfig(tx, 'earning_paused_globally', 'true')
      const result = await click(tx, user.id, ad)

      expect(result.outcome).toBe('earning_blocked')
      expect(await balanceOf(tx, user.id)).toBe(0)

      // And it pays the moment the switch goes off, without the user having
      // to find the ad again.
      await setConfig(tx, 'earning_paused_globally', 'false')
      await openedArticle(tx, user.id, ad, 60)
      expect((await click(tx, user.id, ad)).outcome).toBe('correct')
      expect(await balanceOf(tx, user.id)).toBe(await worth(tx, user.id))
    })
  })

  it('spends the same daily allowance as every other format', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Capped' })
      const ad = await newLinkAd(tx, { points: 25, dwell: 5 })
      await openedArticle(tx, user.id, ad, 60)

      /*
        Their allowance is spent for today — written into the counters, which
        is where a real day of watching would have put it. NOT by setting the
        plan's cap to zero: that is "this plan cannot earn at all", a
        different refusal with a different message, and the test would pass
        while proving something else.
      */
      await tx.query(
        `insert into public.daily_earning_counters (user_id, day, ads_completed)
         values ($1, public.utc_today(),
                 (select daily_ad_cap from public.tiers where is_default))
         on conflict (user_id, day)
           do update set ads_completed = excluded.ads_completed`,
        [user.id],
      )

      const result = await click(tx, user.id, ad)
      expect(result.outcome).toBe('daily_cap_reached')
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('refuses to treat a video or a survey as a link ad', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Wrong Format' })
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.ads
           (title, format, status, points_reward, video_source, youtube_video_id,
            duration_seconds, min_watch_seconds, weight)
         values ('A video', 'video', 'active', 50, 'youtube', 'dQw4w9WgXcQ', 30, 10, 100)
         returning id`,
      )
      const videoId = rows[0]!.id
      await openedArticle(tx, user.id, videoId, 60)

      const message = await expectRejection(tx, () => click(tx, user.id, videoId))
      expect(message).toContain('Not a link ad')
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('will not let a link ad carry a question', async () => {
    await withRollback(async (tx) => {
      const ad = await newLinkAd(tx)
      const message = await expectRejection(tx, () =>
        tx.query(
          `insert into public.ad_questions (ad_id, position, question_text, answer_format)
           values ($1, 0, 'Did you read it?', 'multiple_choice')`,
          [ad],
        ),
      )
      expect(message).toContain('cannot carry questions')
    })
  })

  describe('the shape a link ad must have', () => {
    const shapes: { name: string; columns: string; values: string }[] = [
      {
        name: 'without an article',
        columns: 'min_watch_seconds, cta_links',
        values: `15, '[{"kind":"website","value":"example.com"}]'::jsonb`,
      },
      {
        name: 'without a destination',
        columns: 'min_watch_seconds, article_body',
        values: `15, 'A body that is comfortably longer than the forty character floor.'`,
      },
      {
        name: 'with two destinations',
        columns: 'min_watch_seconds, article_body, cta_links',
        values: `15, 'A body that is comfortably longer than the forty character floor.',
                 '[{"kind":"website","value":"a.com"},{"kind":"website","value":"b.com"}]'::jsonb`,
      },
      {
        name: 'without a reading time',
        columns: 'article_body, cta_links',
        values: `'A body that is comfortably longer than the forty character floor.',
                 '[{"kind":"website","value":"example.com"}]'::jsonb`,
      },
      {
        name: 'with a reading time under three seconds',
        columns: 'min_watch_seconds, article_body, cta_links',
        values: `1, 'A body that is comfortably longer than the forty character floor.',
                 '[{"kind":"website","value":"example.com"}]'::jsonb`,
      },
      {
        name: 'carrying a video',
        columns: 'min_watch_seconds, article_body, cta_links, video_source, youtube_video_id',
        values: `15, 'A body that is comfortably longer than the forty character floor.',
                 '[{"kind":"website","value":"example.com"}]'::jsonb, 'youtube', 'dQw4w9WgXcQ'`,
      },
    ]

    for (const shape of shapes) {
      it(`refuses one ${shape.name}`, async () => {
        await withRollback(async (tx) => {
          const message = await expectRejection(tx, () =>
            tx.query(
              `insert into public.ads (title, format, status, points_reward, weight, ${shape.columns})
               values ('Malformed', 'link', 'draft', 25, 100, ${shape.values})`,
            ),
          )
          expect(message).toMatch(/ads_video_shape|ads_article_body_length/)
        })
      })
    }

    it('refuses an article shorter than the floor', async () => {
      await withRollback(async (tx) => {
        const message = await expectRejection(tx, () =>
          newLinkAd(tx, { article: 'Too short.' }),
        )
        expect(message).toContain('ads_article_body_length')
      })
    })

    it('still refuses a call to action on a survey', async () => {
      await withRollback(async (tx) => {
        const message = await expectRejection(tx, () =>
          tx.query(
            `insert into public.ads (title, format, status, points_reward, weight, cta_links)
             values ('A survey', 'survey', 'draft', 80, 100,
                     '[{"kind":"website","value":"example.com"}]'::jsonb)`,
          ),
        )
        expect(message).toContain('ads_cta_video_or_link')
      })
    })
  })

  it('sends the article out with the feed, so the reader needs no second call', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Feed Reader' })
      const article = 'The advertiser wrote this, and the feed carries it whole.'.padEnd(80, '.')
      const ad = await newLinkAd(tx, { article })

      const { rows } = await tx.query<{ id: string; format: string; article_body: string | null }>(
        `select id, format, article_body from public.get_ad_feed($1, 'link', 40)`,
        [user.id],
      )

      const mine = rows.find((row) => row.id === ad)
      expect(mine).toBeDefined()
      expect(mine!.format).toBe('link')
      expect(mine!.article_body).toBe(article)
    })
  })

  it('keeps record_ad_link_click out of reach of a browser token', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query<{ role: string; allowed: boolean }>(
        `select r.rolname as role,
                has_function_privilege(r.rolname, p.oid, 'execute') as allowed
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace,
                unnest(array['anon', 'authenticated']) as r(rolname)
          where n.nspname = 'public' and p.proname = 'record_ad_link_click'`,
      )
      expect(rows).toHaveLength(2)
      for (const row of rows) expect(row.allowed).toBe(false)
    })
  })
})
