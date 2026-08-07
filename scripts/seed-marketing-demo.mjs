/**
 * The account the landing-page screenshots are taken from.
 *
 * The imagery on that page is the real app, so the balances on it have to
 * belong to a real account. This creates one: George, with the figures the
 * operator specified (2026-08-07) on both sides of the business.
 *
 * ⚠️ IT IS SEEDED, SHOT, AND REMOVED. A demo account with a five-figure
 * balance sitting in the live database is a number that turns up in a report
 * one day and nobody can explain. Run `--drop` as soon as the captures are in.
 *
 *   node --env-file=.env.local scripts/seed-marketing-demo.mjs
 *   PORT=3100 npx next start
 *   SHOOT_EMAIL=george@demo.invalid SHOOT_PASSWORD=... node scripts/shoot-marketing.mjs
 *   node --env-file=.env.local scripts/seed-marketing-demo.mjs --drop
 */
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const EMAIL = 'george@demo.invalid'
const PASSWORD = 'Marketing!2026'
const NAME = 'George'

/**
 * ⚠️ THE BUYER OF THE DEMO SALE IS ALSO A DEMO ACCOUNT, AND THIS COST ME A
 * CLEAN-UP. The first version of this script reached for `select id from
 * auth.users limit 1` as the buyer, which put two fake confirmed GHS 350
 * orders on a real person's account — invisible here, permanent there, and
 * still sitting in the revenue figures after the demo account was removed.
 * Seed data must never attach itself to a row somebody else owns.
 */
const BUYER_EMAIL = 'buyer@demo.invalid'

/** What the operator asked the screenshots to show. */
const POINTS_BALANCE = 134_500 // GHS 1,345.00 at 100 points to the cedi
const COMMISSION_MINOR = 263_400 // GHS 2,634.00
/** Part of the commission comes from a real sale, so the dashboard is not all
 *  zeros above a balance that came from nowhere. */
const SALE_COMMISSION_MINOR = 7_000

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

await db.connect()
const drop = process.argv.includes('--drop')

/** Everything this script ever wrote, in dependency order. */
const purge = async (email) => {
  const { rows: existing } = await db.query(`select id from auth.users where email = $1`, [email])
  const previous = existing[0]?.id ?? null
  if (previous) {
    const { rows: aff } = await db.query(
      `select id from public.affiliate_accounts where user_id = $1`,
      [previous],
    )
    if (aff.length) {
      await db.query(`delete from public.commission_payouts where user_id = $1`, [previous])
      await db.query(`alter table public.commission_ledger disable trigger user`)
      await db.query(`delete from public.commission_ledger where affiliate_id = $1`, [aff[0].id])
      await db.query(`alter table public.commission_ledger enable trigger user`)
      await db.query(
        `delete from public.conversions where affiliate_id = $1`,
        [aff[0].id],
      )
      await db.query(`delete from public.affiliate_clicks where affiliate_id = $1`, [aff[0].id])
      await db.query(`delete from public.affiliate_entitlements where affiliate_id = $1`, [aff[0].id])
      await db.query(`delete from public.affiliate_accounts where id = $1`, [aff[0].id])
    }
    await db.query(`delete from public.lesson_progress where user_id = $1`, [previous])
    await db.query(`delete from public.orders where user_id = $1`, [previous])
    await db.query(`alter table public.points_ledger disable trigger user`)
    await db.query(`delete from public.points_ledger where user_id = $1`, [previous])
    await db.query(`alter table public.points_ledger enable trigger user`)
    for (const table of ['user_balances', 'user_subscriptions', 'notifications', 'fraud_signals']) {
      await db.query(`delete from public.${table} where user_id = $1`, [previous])
    }
    await db.query(`delete from auth.users where id = $1`, [previous])
    console.log(`removed ${email}`)
  }
}

try {
  for (const email of [EMAIL, BUYER_EMAIL]) await purge(email)

  if (drop) {
    const { rows } = await db.query(
      `select count(*)::int n from auth.users where email like '%@demo.invalid'`,
    )
    console.log(`done: ${rows[0].n} demo account(s) remain`)
    process.exit(0)
  }

  // ---- The account -------------------------------------------------------
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: NAME },
  })
  if (error) throw error
  const userId = data.user.id

  /* The top plan, so the feed shows a full day's allowance rather than the
     one ad a free account gets. */
  await db.query(
    `insert into public.user_subscriptions (user_id, tier_id, status, started_at, current_period_end)
     select $1, id, 'active', now() - interval '20 days', now() + interval '40 days'
       from public.tiers where slug = 'platinum'`,
    [userId],
  )

  await db.query(`select public.credit_points($1, $2, 'admin_adjustment')`, [
    userId,
    POINTS_BALANCE,
  ])

  // ---- The affiliate side ------------------------------------------------
  await db.query(
    `insert into public.affiliate_accounts (user_id, affiliate_code, status, activated_at)
     values ($1, public.generate_affiliate_code(), 'active', now() - interval '18 days')`,
    [userId],
  )
  const { rows: acc } = await db.query(
    `select id from public.affiliate_accounts where user_id = $1`,
    [userId],
  )
  const affiliateId = acc[0].id

  /* Professional, so the dashboard shows two commission levels. */
  const { rows: programme } = await db.query(
    `select tp.id, tp.product_id, tp.validity_days, tp.grace_days, tp.commission_depth
       from public.training_programs tp
       join public.products p on p.id = tp.product_id
      where tp.level::text = 'professional' limit 1`,
  )
  const { rows: order } = await db.query(
    `insert into public.orders
       (user_id, product_id, kind, amount_minor, list_price_minor, method, status, confirmed_at)
     select $1, $2, 'purchase', p.price_minor, p.price_minor, 'paystack', 'confirmed',
            now() - interval '18 days'
       from public.products p where p.id = $2
     returning id`,
    [userId, programme[0].product_id],
  )
  await db.query(
    `insert into public.affiliate_entitlements
       (affiliate_id, training_program_id, order_id, commission_depth,
        starts_at, expires_at, grace_ends_at, status)
     values ($1, $2, $3, $4, now() - interval '18 days',
             now() + interval '347 days', now() + interval '352 days', 'active')`,
    [affiliateId, programme[0].id, order[0].id, programme[0].commission_depth],
  )

  /* Finished training. An unfinished-course nag is the largest card on the
     dashboard, and a landing page should not be showing the one screen that
     says this person has not started yet. */
  await db.query(
    `insert into public.lesson_progress
       (user_id, lesson_id, seconds_watched, watched_percent, quiz_passed, completed_at)
     select $1, l.id, coalesce(l.duration_seconds, 300), 100, true, now() - interval '9 days'
       from public.lessons l
       join public.course_sections cs on cs.id = l.section_id
      where cs.product_id = $2
     on conflict (user_id, lesson_id) do update
        set watched_percent = 100, quiz_passed = true, completed_at = excluded.completed_at`,
    [userId, programme[0].product_id],
  )

  /* A little traffic, so clicks and sales are not all zero above the balance. */
  const { rows: product } = await db.query(
    `select id from public.products where purpose = 'vendor_product' and status = 'published' limit 1`,
  )
  const target = product[0]?.id ?? programme[0].product_id
  for (let i = 0; i < 34; i += 1) {
    await db.query(
      `insert into public.affiliate_clicks (affiliate_id, product_id, visitor_token, created_at)
       values ($1, $2, $3, now() - (interval '1 day' * $4))`,
      [affiliateId, target, `demo-${Date.now()}-${i}`, i % 20],
    )
  }

  const { data: buyerAuth, error: buyerError } = await sb.auth.admin.createUser({
    email: BUYER_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Demo Buyer' },
  })
  if (buyerError) throw buyerError
  const buyer = [{ id: buyerAuth.user.id }]

  const { rows: sale } = await db.query(
    `insert into public.orders
       (user_id, product_id, kind, amount_minor, list_price_minor, method, status, confirmed_at)
     values ($1, $2, 'purchase', 35000, 35000, 'paystack', 'confirmed', now() - interval '6 days')
     returning id`,
    [buyer[0].id, target],
  )
  const { rows: prog2 } = await db.query(`select id from public.affiliate_programs limit 1`)
  const { rows: conversion } = await db.query(
    `insert into public.conversions
       (order_id, affiliate_id, program_id, attribution_model, base_minor, l1_rate, status, attributed_at)
     values ($1, $2, $3, 'last_click', 35000, 20, 'attributed', now() - interval '6 days')
     returning id`,
    [sale[0].id, affiliateId, prog2[0].id],
  )

  await db.query(
    `insert into public.commission_ledger
       (affiliate_id, conversion_id, entry_type, amount_minor, level, status, reason, idempotency_key)
     values ($1, $2, 'credit', $3, 1, 'cleared', 'Demo sale', $4)`,
    [affiliateId, conversion[0].id, SALE_COMMISSION_MINOR, `demo-sale-${Date.now()}`],
  )
  await db.query(
    `insert into public.commission_ledger
       (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
     values ($1, 'adjustment', $2, 'cleared', 'Demo balance', $3)`,
    [affiliateId, COMMISSION_MINOR - SALE_COMMISSION_MINOR, `demo-top-${Date.now()}`],
  )

  const { rows: check } = await db.query(
    `select (select balance from public.user_balances where user_id = $1) as points,
            public.affiliate_balance_minor($2) as commission`,
    [userId, affiliateId],
  )
  console.log(`seeded ${EMAIL}`)
  console.log(`  points     ${check[0].points} (GHS ${(Number(check[0].points) / 100).toFixed(2)})`)
  console.log(`  commission ${check[0].commission} (GHS ${(Number(check[0].commission) / 100).toFixed(2)})`)
  console.log(`  password   ${PASSWORD}`)
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
