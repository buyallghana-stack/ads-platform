import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, withRollback } from '../support/db'

/**
 * The reads the rebuilt affiliate UI is built on — migrations 147 to 152.
 *
 * Every one of these is a READ, so nothing here moves money. What they are
 * about is the ways a read can be wrong that cost money anyway:
 *
 *  1. A figure on a card that does not match what the ledger will pay. The
 *     product card advertises "you earn GHS 60.00"; if that is computed
 *     differently from `pay_conversion_commissions`, the affiliate is owed an
 *     explanation nobody can give.
 *
 *  2. A chart that draws a straight line across days with no data, which turns
 *     "nothing happened" into "steady activity" — a flattering lie rather than
 *     a neutral one.
 *
 *  3. A statement that shows somebody else's rows. This is the first read that
 *     exposes the commission ledger to a non-admin at all.
 *
 *  4. A grant. Phase 2 RPCs are server-only, and `create or replace function`
 *     silently re-grants EXECUTE to PUBLIC every single time one is edited.
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

/** A published training programme with an active affiliate program on it. */
const makeTraining = async (
  tx: Tx,
  by: string,
  o: { l1?: number; l2?: number; priceMinor?: number; lessons?: number; threshold?: number } = {},
) => {
  const { l1 = 20, l2 = 5, priceMinor = 40000, lessons = 4, threshold = 50 } = o
  seq += 1

  const { rows: prod } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'training_program', 'Reads Training', $1, $2, 'published', $3) returning id`,
    [`reads-${Date.now()}-${seq}`, priceMinor, by],
  )
  const productId = prod[0]!.id

  await tx.query(
    `insert into public.training_programs
       (product_id, level, commission_depth, activation_threshold_percent,
        lesson_pass_percent, quiz_required, validity_days, grace_days)
     values ($1, 'professional', 2, $2, 90, false, 365, 5)`,
    [productId, threshold],
  )
  await tx.query(
    `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value)
     values ($1, $2, $3)`,
    [productId, l1, l2],
  )

  const { rows: sec } = await tx.query<{ id: string }>(
    `insert into public.course_sections (product_id, title, position)
     values ($1, 'Only Section', 0) returning id`,
    [productId],
  )

  const lessonIds: string[] = []
  for (let i = 0; i < lessons; i += 1) {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.lessons (section_id, title, position, kind, duration_seconds, storage_path)
       values ($1, $2, $3, 'video', 600, 'x/y.mp4') returning id`,
      [sec[0]!.id, `Lesson ${i + 1}`, i],
    )
    lessonIds.push(rows[0]!.id)
  }

  return { productId, lessonIds }
}

const buy = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.start_product_order($1, $2, 'paystack')`,
    [userId, productId],
  )
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2)`, [
    rows[0]!.id,
    `READS-${Date.now()}-${seq}`,
  ])
  return rows[0]!.id
}

/** Buys the training and finishes enough of it to switch the account on. */
const activate = async (tx: Tx, userId: string, by: string) => {
  const { productId, lessonIds } = await makeTraining(tx, by)
  await buy(tx, userId, productId)
  for (const id of lessonIds.slice(0, 2)) {
    await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, true)`, [userId, id])
  }
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.affiliate_accounts where user_id = $1`,
    [userId],
  )
  return { productId, affiliateId: rows[0]!.id }
}

/**
 * A credit needs a conversion — `commission_credit_shape` refuses one without.
 * That constraint is doing real work, so the test honours it rather than
 * reaching for an `adjustment` to dodge it: a statement row joined through a
 * conversion to an order to a product is the shape the screen actually renders,
 * and inventing a shortcut here would leave the join untested.
 */
const creditFor = async (
  tx: Tx,
  o: { affiliateId: string; buyerId: string; productId: string; amountMinor: number; level?: 1 | 2; status?: string; pending?: boolean },
) => {
  const { affiliateId, buyerId, productId, amountMinor, level = 1, pending = false } = o
  seq += 1

  const { rows: order } = await tx.query<{ id: string }>(
    `select id from public.start_product_order($1, $2, 'paystack')`,
    [buyerId, productId],
  )
  const { rows: program } = await tx.query<{ id: string }>(
    `select id from public.affiliate_programs where product_id = $1 and status = 'active'`,
    [productId],
  )
  const { rows: conversion } = await tx.query<{ id: string }>(
    `insert into public.conversions (order_id, affiliate_id, program_id, base_minor, status, l1_rate)
     values ($1, $2, $3, $4, 'attributed', 20) returning id`,
    [order[0]!.id, affiliateId, program[0]!.id, amountMinor],
  )
  await tx.query(
    `insert into public.commission_ledger
       (affiliate_id, conversion_id, level, entry_type, amount_minor, status, clears_at, idempotency_key)
     values ($1, $2, $3, 'credit', $4, $5, $6, $7)`,
    [
      affiliateId,
      conversion[0]!.id,
      level,
      amountMinor,
      pending ? 'pending' : 'cleared',
      pending ? new Date(Date.now() + 7 * 86400000) : null,
      `reads-credit-${Date.now()}-${seq}`,
    ],
  )
}

const perf = async (tx: Tx, userId: string, days = 30) => {
  const { rows } = await tx.query<{ p: Record<string, unknown> }>(
    `select public.affiliate_performance($1, $2) as p`,
    [userId, days],
  )
  return rows[0]!.p
}

/* ------------------------------------------------------------------ */
/* 147 — the tier card                                                 */
/* ------------------------------------------------------------------ */
describe.skipIf(!HAS_DB)('get_user_earning_status carries the multiplier', () => {
  it('returns the RESOLVED multiplier, not the raw column on a tiers row', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Multiplier Reader' })

      const { rows } = await tx.query<{ reward_multiplier: string; tier_slug: string }>(
        `select reward_multiplier, tier_slug from public.get_user_earning_status($1)`,
        [user.id],
      )

      expect(rows).toHaveLength(1)

      /*
        The property that matters is not the VALUE — the operator retunes the
        ladder in the admin, so any literal here would be a hostage. It is that
        the function and `resolve_user_tier` agree, because resolve_user_tier
        is what stacking and clamping run through and a `tiers` read is not.
      */
      const { rows: resolved } = await tx.query<{ m: string }>(
        `select (public.resolve_user_tier($1)).reward_multiplier as m`,
        [user.id],
      )
      expect(Number(rows[0]!.reward_multiplier)).toBe(Number(resolved[0]!.m))
    })
  })
})

/* ------------------------------------------------------------------ */
/* 148 / 149 — performance over time                                   */
/* ------------------------------------------------------------------ */
describe.skipIf(!HAS_DB)('affiliate_performance', () => {
  it('answers with an empty shape rather than an error for a non-affiliate', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Never Joined' })
      const p = await perf(tx, user.id, 7)

      // This screen is reachable by every signed-in user. A 500 on the second
      // business's front door is a worse outcome than an empty chart.
      expect(p.series).toEqual([])
      expect(p.clicks).toBe(0)
      expect(p.visitors).toBe(0)
    })
  })

  it('gap-fills: a day with no activity is a zero, never a missing point', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Quiet Affiliate' })
      await activate(tx, user.id, by)

      const p = await perf(tx, user.id, 7)
      const series = p.series as { day: string; clicks: number; earned_minor: number }[]

      /*
        Seven days requested, seven points back, all zero. A chart that skipped
        absent days would draw a straight segment across them, which reads as
        steady activity over a period when there was none.
      */
      expect(series).toHaveLength(7)
      expect(series.every((d) => d.clicks === 0 && Number(d.earned_minor) === 0)).toBe(true)
      // And they are consecutive, oldest first.
      const days = series.map((d) => d.day)
      expect([...days].sort()).toEqual(days)
    })
  })

  it('counts PEOPLE distinctly, while clicks count every visit', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Popular Affiliate' })
      const { productId, affiliateId } = await activate(tx, user.id, by)

      /* One person visiting three times, and a second person once. */
      for (const token of ['visitor-a', 'visitor-a', 'visitor-a', 'visitor-b']) {
        await tx.query(
          `insert into public.affiliate_clicks (affiliate_id, product_id, visitor_token)
           values ($1, $2, $3)`,
          [affiliateId, productId, token],
        )
      }

      const p = await perf(tx, user.id, 7)

      /*
        This distinction is the whole reason the middle column exists: 4 clicks
        from 2 people and 4 clicks from 4 people are opposite problems with
        opposite fixes, and a click count alone cannot tell them apart.
      */
      expect(p.clicks).toBe(4)
      expect(p.visitors).toBe(2)
    })
  })

  it('does not put `visitors` in the series, because daily distinct counts do not sum', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Series Reader' })
      await activate(tx, user.id, by)

      const p = await perf(tx, user.id, 7)
      const first = (p.series as Record<string, unknown>[])[0]!

      /*
        Somebody who clicks on Monday and again on Friday is ONE person in the
        weekly figure and would be two if the daily counts were added. Leaving
        the field out of the series is what stops a caller from summing it.
      */
      expect(Object.keys(first).sort()).toEqual(['clicks', 'conversions', 'day', 'earned_minor'])
    })
  })

  it('clamps a hand-typed window instead of trusting it', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Curious Affiliate' })
      await activate(tx, user.id, by)

      expect((await perf(tx, user.id, 100000)).days).toBe(365)
      expect((await perf(tx, user.id, 0)).days).toBe(1)
    })
  })
})

/* ------------------------------------------------------------------ */
/* 150 — the offer says what it gives                                  */
/* ------------------------------------------------------------------ */
describe.skipIf(!HAS_DB)('affiliate_dashboard training offers', () => {
  it('carries what the join screen needs to describe the offer', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      await makeTraining(tx, by, { threshold: 60 })
      const user = await createUser(tx, { name: 'Deciding' })

      const { rows } = await tx.query<{ d: Record<string, unknown> }>(
        `select public.affiliate_dashboard($1) as d`,
        [user.id],
      )
      const offers = rows[0]!.d.training_offers as Record<string, unknown>[]
      const mine = offers.find((o) => o.threshold === 60)

      /*
        The two programmes differ in exactly one field. Without these, the join
        screen either says nothing (two prices, no reasons) or says something
        invented — on the screen where somebody decides to spend GHS 400.
      */
      expect(mine).toBeDefined()
      expect(mine!.validity_days).toBe(365)
      expect(mine!.certificate).toBeDefined()
      expect(mine!.depth).toBe(2)
      expect(Number(mine!.lessons)).toBeGreaterThan(0)
    })
  })
})

/* ------------------------------------------------------------------ */
/* 151 — a product card shows what it pays                             */
/* ------------------------------------------------------------------ */
describe.skipIf(!HAS_DB)('shop_products carries the commission', () => {
  it('advertises exactly what affiliate_promote_info would quote', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Promoter' })
      await activate(tx, user.id, by)

      /* An odd price and an odd rate, so a rounding difference cannot hide. */
      const { productId } = await makeTraining(tx, by, { priceMinor: 33333, l1: 17.5 })

      const { rows: card } = await tx.query<{ l1_earn_minor: string; can_promote: boolean }>(
        `select l1_earn_minor, can_promote from public.shop_products($1) where id = $2`,
        [user.id, productId],
      )
      const { rows: panel } = await tx.query<{ e: string }>(
        `select (public.affiliate_promote_info($1, $2) ->> 'l1EarnMinor') as e`,
        [user.id, productId],
      )

      /*
        The grid and the detail panel must quote the same figure, and both must
        be the figure the ledger will pay. `round(price * rate / 100)` in
        Postgres — a browser float and an exact numeric disagree on half a
        pesewa, and that discrepancy is permanent and screenshotted.
      */
      expect(Number(card[0]!.l1_earn_minor)).toBe(Number(panel[0]!.e))
      expect(Number(card[0]!.l1_earn_minor)).toBe(Math.round((33333 * 17.5) / 100))
    })
  })

  it('refuses to offer Promote on a product above the affiliate tier', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Beginner Only' })

      /* Activate on a BEGINNER programme. */
      seq += 1
      const { rows: prod } = await tx.query<{ id: string }>(
        `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
         values ('course', 'training_program', 'Starter', $1, 15000, 'published', $2) returning id`,
        [`reads-beg-${Date.now()}-${seq}`, by],
      )
      await tx.query(
        `insert into public.training_programs
           (product_id, level, commission_depth, activation_threshold_percent,
            lesson_pass_percent, quiz_required, validity_days, grace_days)
         values ($1, 'beginner', 1, 50, 90, false, 365, 5)`,
        [prod[0]!.id],
      )
      const { rows: sec } = await tx.query<{ id: string }>(
        `insert into public.course_sections (product_id, title, position)
         values ($1, 'S', 0) returning id`,
        [prod[0]!.id],
      )
      const lessons: string[] = []
      for (let i = 0; i < 2; i += 1) {
        const { rows } = await tx.query<{ id: string }>(
          `insert into public.lessons (section_id, title, position, kind, duration_seconds, storage_path)
           values ($1, $2, $3, 'video', 600, 'x/y.mp4') returning id`,
          [sec[0]!.id, `L${i}`, i],
        )
        lessons.push(rows[0]!.id)
      }
      await buy(tx, user.id, prod[0]!.id)
      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, true)`, [
        user.id,
        lessons[0]!,
      ])

      /* A product gated to professional. */
      const { productId: gated } = await makeTraining(tx, by)
      await tx.query(
        `update public.products set min_affiliate_tier = 'professional' where id = $1`,
        [gated],
      )

      const { rows } = await tx.query<{ can_promote: boolean; l1_rate: string | null }>(
        `select can_promote, l1_rate from public.shop_products($1) where id = $2`,
        [user.id, gated],
      )

      // Eligibility is per ROW: min_affiliate_tier lives on the product.
      expect(rows[0]!.can_promote).toBe(false)
      // But the rate is still published — it is the argument for upgrading,
      // and hiding it makes the gate look arbitrary.
      expect(rows[0]!.l1_rate).not.toBeNull()
    })
  })
})

/* ------------------------------------------------------------------ */
/* 152 — the statement                                                 */
/* ------------------------------------------------------------------ */
describe.skipIf(!HAS_DB)('affiliate_statement', () => {
  it('returns only the caller’s own entries', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const mine = await createUser(tx, { name: 'Mine' })
      const theirs = await createUser(tx, { name: 'Theirs' })
      const buyer = await createUser(tx, { name: 'Buyer' })
      const a = await activate(tx, mine.id, by)
      const b = await activate(tx, theirs.id, by)
      const { productId } = await makeTraining(tx, by)

      await creditFor(tx, {
        affiliateId: a.affiliateId,
        buyerId: buyer.id,
        productId,
        amountMinor: 1234,
      })
      await creditFor(tx, {
        affiliateId: b.affiliateId,
        buyerId: buyer.id,
        productId,
        amountMinor: 9999,
      })

      const { rows } = await tx.query<{ s: Record<string, unknown> }>(
        `select public.affiliate_statement($1, 100) as s`,
        [mine.id],
      )
      const entries = rows[0]!.s.entries as { amount_minor: number }[]

      // This is the first read that exposes the commission ledger to a
      // non-admin. One leaked row is somebody else's earnings.
      expect(entries).toHaveLength(1)
      expect(Number(entries[0]!.amount_minor)).toBe(1234)
    })
  })

  it('carries enough for a row to be readable, not just an amount', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Statement Reader' })
      const { affiliateId } = await activate(tx, user.id, by)
      const buyer = await createUser(tx, { name: 'Detail Buyer' })
      const { productId } = await makeTraining(tx, by)

      await creditFor(tx, {
        affiliateId,
        buyerId: buyer.id,
        productId,
        amountMinor: 5000,
        level: 2,
        pending: true,
      })

      const { rows } = await tx.query<{ s: Record<string, unknown> }>(
        `select public.affiliate_statement($1, 100) as s`,
        [user.id],
      )
      const entry = (rows[0]!.s.entries as Record<string, unknown>[])[0]!

      /*
        An amount and a date are not a statement line. `entry_type`
        distinguishes a payout from a reversal — both money leaving, for
        opposite reasons — and `clears_at` answers the single most common
        support question a commission system generates.
      */
      expect(entry.entry_type).toBe('credit')
      expect(entry.level).toBe(2)
      expect(entry.status).toBe('pending')
      expect(entry.clears_at).not.toBeNull()
      /* And the join all the way out to the product, which is the single most
         useful field for recognising an entry and the one an amount cannot
         substitute for. */
      expect(entry.product_title).toBe('Reads Training')
    })
  })

  it('answers with an empty statement rather than an error for a non-affiliate', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Not An Affiliate' })
      const { rows } = await tx.query<{ s: Record<string, unknown> }>(
        `select public.affiliate_statement($1, 10) as s`,
        [user.id],
      )
      expect(rows[0]!.s.entries).toEqual([])
      expect(rows[0]!.s.payouts).toEqual([])
    })
  })
})

/* ------------------------------------------------------------------ */
/* The grants                                                          */
/* ------------------------------------------------------------------ */
describe.skipIf(!HAS_DB)('the new reads are not reachable with the anon key', () => {
  it('grants EXECUTE to service_role only', async () => {
    await withRollback(async (tx) => {
      /*
        ⚠️ `create or replace function` re-grants EXECUTE to PUBLIC every time.
        Seventeen functions were once readable with the publishable key because
        of exactly this, so it is asserted rather than remembered.
      */
      const { rows } = await tx.query<{ proname: string; who: string | null }>(
        /* `aclexplode` hands back the grantee as an OID, and OID 0 is PUBLIC —
           which has no `pg_roles` row, so an inner join would silently drop the
           single most dangerous case. `coalesce` names it explicitly. */
        `select p.proname,
                (select string_agg(coalesce(a.rolname, 'public'), ',')
                   from aclexplode(p.proacl) x
                   left join pg_roles a on a.oid = x.grantee
                  where x.privilege_type = 'EXECUTE'
                    and coalesce(a.rolname, 'public') in ('public', 'anon', 'authenticated')) as who
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('affiliate_performance', 'affiliate_statement',
                              'affiliate_dashboard', 'shop_products')`,
      )

      expect(rows.length).toBe(4)
      for (const row of rows) {
        expect(`${row.proname}:${row.who ?? 'none'}`).toBe(`${row.proname}:none`)
      }
    })
  })

  it('still lets a signed-in user read their own earning status', async () => {
    await withRollback(async (tx) => {
      /* The counterpart: 147 must NOT have locked out `authenticated`, which
         is the one Phase 1 read a user client calls directly. */
      const { rows } = await tx.query<{ ok: boolean }>(
        `select has_function_privilege('authenticated',
                  'public.get_user_earning_status(uuid)', 'EXECUTE') as ok`,
      )
      expect(rows[0]!.ok).toBe(true)
    })
  })
})
