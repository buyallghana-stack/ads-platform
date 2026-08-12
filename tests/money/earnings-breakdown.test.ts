import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  createUser,
  creditPoints,
  pinEconomy,
  withRollback,
} from '../support/db'

/**
 * The earnings breakdown, on the ads side.
 *
 * ONE PROPERTY MATTERS MORE THAN THE REST: the parts add up. A breakdown that
 * disagrees with the balance on the Home screen is worse than no breakdown at
 * all, because it teaches somebody that one of the two figures is lying and
 * gives them no way to tell which. Every test below is a variation on that.
 *
 * The eleven `ledger_entry_type` values are the whole vocabulary, so a new one
 * added later without a line on the page will show up here as a sum that no
 * longer reconciles.
 */

const breakdown = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<Record<string, string>>(
    `select videos_points::text, surveys_points::text, articles_points::text,
            referral_signup_points::text, referral_activation_points::text,
            referral_purchase_points::text, game_points::text, task_points::text,
            gift_code_points::text, adjustment_points::text, earned_points::text,
            withdrawn_paid_points::text, withdrawn_pending_points::text,
            withdrawn_refunded_points::text, plans_spent_minor::text,
            plans_count::text, balance_points::text
       from public.get_earnings_breakdown($1)`,
    [userId],
  )
  const r = rows[0]!
  const n = (k: string) => Number(r[k])
  return {
    videos: n('videos_points'),
    surveys: n('surveys_points'),
    articles: n('articles_points'),
    referralSignup: n('referral_signup_points'),
    referralPurchase: n('referral_purchase_points'),
    games: n('game_points'),
    tasks: n('task_points'),
    giftCodes: n('gift_code_points'),
    adjustments: n('adjustment_points'),
    earned: n('earned_points'),
    withdrawnPaid: n('withdrawn_paid_points'),
    withdrawnPending: n('withdrawn_pending_points'),
    plansSpent: n('plans_spent_minor'),
    plansCount: Number(r.plans_count),
    balance: n('balance_points'),
  }
}

/** Writes one ledger row directly, for the sources that have no cheap helper. */
const credit = async (
  tx: Tx,
  userId: string,
  entryType: string,
  amount: number,
  reference?: { type: string; id: string },
) => {
  await tx.query(
    /* `points_per_currency_unit` is NOT NULL on the ledger: every row records
       the peg that was in force when it was written, so history cannot be
       restated by changing a setting. Taken from config rather than typed in. */
    `insert into public.points_ledger
       (user_id, entry_type, amount, balance_after, reference_type, reference_id,
        points_per_currency_unit)
     values ($1, $2::public.ledger_entry_type, $3,
             coalesce((select balance_after from public.points_ledger
                        where user_id = $1 order by id desc limit 1), 0) + $3,
             $4, $5, public.config_int('points_per_currency_unit'))`,
    [userId, entryType, amount, reference?.type ?? null, reference?.id ?? null],
  )
}

describe.skipIf(!HAS_DB)('the earnings breakdown adds up', () => {
  it('accounts for every kind of earning', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx, { name: 'Every Source' })

      await creditPoints(tx, user.id, 500) // ad_view
      await credit(tx, user.id, 'survey', 300)
      await credit(tx, user.id, 'referral_signup', 100)
      await credit(tx, user.id, 'referral_purchase', 250)
      await credit(tx, user.id, 'game_prize', 40)
      await credit(tx, user.id, 'task_reward', 60)
      await credit(tx, user.id, 'gift_code', 200)

      const b = await breakdown(tx, user.id)

      /* The two the operator did not list are the ones most likely to be
         dropped by a later change, so they are asserted by name. */
      expect(b.tasks).toBe(60)
      expect(b.giftCodes).toBe(200)

      /* THE PROPERTY, not a hardcoded total: the parts equal what the page
         calls the total. An absolute figure here would only be asserting how
         `credit_points` prices an ad, which is another file's job. */
      const parts =
        b.videos +
        b.surveys +
        b.articles +
        b.referralSignup +
        b.referralPurchase +
        b.games +
        b.tasks +
        b.giftCodes +
        b.adjustments
      expect(parts).toBe(b.earned)
      expect(b.earned).toBeGreaterThan(0)
    })
  })

  it('shows an administrative adjustment, in whichever direction', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx, { name: 'Adjusted' })

      await creditPoints(tx, user.id, 1000)
      await credit(tx, user.id, 'admin_adjustment', -250)

      const b = await breakdown(tx, user.id)
      /* Negative and visible. Hiding it would make the page wrong for exactly
         the person most likely to be querying their balance. */
      expect(b.adjustments).toBe(-250)
    })
  })

  it('splits ads by what the ad actually was, not by the entry type', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx, { name: 'Three Formats' })

      /* ⚠️ ONE AD PER FORMAT, MADE HERE. This read the live pool and took
         whatever it found, so on 2026-08-12 — when the operator emptied the
         pool — it looped over nothing, asserted nothing, and PASSED. A test
         that silently checks nothing is worse than one that fails. */
      /* ⚠️ EACH FORMAT HAS ITS OWN SHAPE, and `ads_video_shape` enforces all
         three: a video carries a source and an id; a survey must carry
         neither; an article carries a body, EXACTLY ONE cta link, and a
         reading time of at least 3 seconds — the dwell that is the whole
         defence against farming that format. */
      const { rows } = await tx.query<{ id: string; format: string }>(
        `insert into public.ads (title, format, status, points_reward, video_source,
                                 youtube_video_id, duration_seconds, min_watch_seconds,
                                 weight, article_body, cta_label, cta_links)
         values
           ('Breakdown video', 'video', 'active', 100, 'youtube', 'dQw4w9WgXcQ',
            30, 0, 100, null, null, '[]'::jsonb),
           ('Breakdown survey', 'survey', 'active', 100, null, null,
            null, null, 100, null, null, '[]'::jsonb),
           ('Breakdown article', 'link', 'active', 100, null, null,
            null, 15, 100,
            'An article long enough to satisfy the forty character minimum on ad bodies.',
            'Read more',
            '[{"label": "Open", "url": "https://example.com"}]'::jsonb)
         returning id, format::text`,
      )
      // The sweep must have something to sweep.
      expect(rows.length).toBe(3)
      /* `ad_view` covers videos AND articles; only `ads.format` separates
         them. If this ever regresses, articles silently become videos. */
      for (const ad of rows) {
        await credit(
          tx,
          user.id,
          ad.format === 'survey' ? 'survey' : 'ad_view',
          100,
          { type: 'ad', id: ad.id },
        )
      }

      const b = await breakdown(tx, user.id)
      const byFormat = { link: b.articles, survey: b.surveys, video: b.videos }
      for (const ad of rows) {
        expect([ad.format, byFormat[ad.format as keyof typeof byFormat]]).toEqual([ad.format, 100])
      }
    })
  })

  it('reads a repeated ad, whose reference carries an occasion', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx, { name: 'Repeat Watcher' })

      /* ⚠️ ITS OWN AD, NOT ONE BORROWED FROM THE POOL. This used to read
         `select id from public.ads ... limit 1`, which passed for as long as
         the project happened to contain a video ad and threw the day the
         operator emptied the pool (2026-08-12). A test that depends on live
         content is a test that reports someone else's housekeeping as a bug. */
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.ads (title, format, status, points_reward, video_source,
                                 youtube_video_id, duration_seconds, min_watch_seconds, weight)
         values ('Breakdown fixture', 'video', 'active', 100, 'youtube',
                 'dQw4w9WgXcQ', 30, 0, 100)
         returning id`,
      )
      const adId = rows[0]!.id

      await credit(tx, user.id, 'ad_view', 100, { type: 'ad', id: adId })
      /* From the second completion the reference is `<id>#2`. A breakdown that
         casts the whole string to uuid raises; one that ignores those rows
         under-reports. */
      await credit(tx, user.id, 'ad_view', 100, { type: 'ad', id: `${adId}#2` })
      await credit(tx, user.id, 'ad_view', 100, { type: 'ad', id: `${adId}#3` })

      expect((await breakdown(tx, user.id)).videos).toBe(300)
    })
  })

  it('states what was spent on plans without netting it off', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx, { name: 'Plan Buyer' })
      await creditPoints(tx, user.id, 400)

      const { rows: tier } = await tx.query<{ id: string }>(
        `select id from public.tiers where not is_default and is_active order by price_minor limit 1`,
      )
      const { rows: payment } = await tx.query<{ id: string }>(
        `select id from public.start_subscription_payment($1, $2, 'paystack', null, null)`,
        [user.id, tier[0]!.id],
      )
      await tx.query(`select public.confirm_subscription_payment($1, $2)`, [
        payment[0]!.id,
        `BREAKDOWN-${payment[0]!.id}`,
      ])

      const b = await breakdown(tx, user.id)
      expect(b.plansCount).toBe(1)
      expect(b.plansSpent).toBeGreaterThan(0)
      /* Earnings are untouched by the purchase. The operator's rule: spending
         sits beside earning and is never subtracted from it, so there is no
         combined figure for a screen to render. */
      expect(b.earned).toBe(400)
    })
  })

  it('separates what has been paid from what is still waiting', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const user = await createUser(tx, { name: 'Withdrawer' })
      await creditPoints(tx, user.id, 20_000)

      await tx.query(
        `insert into public.redemptions
           (user_id, status, method, points_amount, points_per_currency_unit,
            currency_code, currency_amount, fee_percent, fee_amount, net_amount,
            holding_until, snapshot_provider_code, snapshot_msisdn, snapshot_account_name,
            paid_at)
         values ($1, 'paid', 'mobile_money', 5000, 100, 'GHS', 50, 2, 1, 49, now(),
                 'MTN', '0240000000', 'Test Person', now()),
                ($1, 'pending_approval', 'mobile_money', 3000, 100, 'GHS', 30, 2, 0.6, 29.4, now(),
                 'MTN', '0240000000', 'Test Person', null)`,
        [user.id],
      )

      const b = await breakdown(tx, user.id)
      expect([b.withdrawnPaid, b.withdrawnPending]).toEqual([5000, 3000])
    })
  })
})
