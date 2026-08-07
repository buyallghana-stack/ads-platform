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
const SALES = 348

/**
 * THE FOUR FUNNEL FIGURES HAVE TO SURVIVE BEING READ ACROSS.
 *
 * The strip is one funnel, not four statistics: clicks arrive, some of them
 * are the same person coming back, a few buy, and the last column is the ratio
 * of the two ends. The dashboard computes each of them itself —
 *
 *   Clicks     count of click rows in the last 30 days
 *   People     count(DISTINCT visitor_token) over the same rows
 *   Sales      attributed conversions in the last 30 days
 *   Conversion sales ÷ clicks, to one decimal
 *
 * — so the seed cannot state them. It has to lay down traffic that produces
 * them, and every one of these has to hold or the card contradicts itself:
 * people ≤ clicks (a visitor cannot click less than once), sales ≤ people, and
 * the rate has to land somewhere an affiliate would recognise.
 *
 * 348 ÷ 4,970 = 7.0%. 4,970 clicks from 3,106 people is 1.6 visits each.
 */
const CLICKS = 4_970
const VISITORS = 3_106

if (VISITORS > CLICKS) throw new Error('people cannot exceed clicks')
if (SALES > VISITORS) throw new Error('sales cannot exceed people')

/**
 * GHS 2,634 spread over 348 sales is GHS 7.57 each, so the demo sells a small
 * item, not the training. The commission is 20% of the order, and the order is
 * priced FROM the commission rather than the other way round, so the two can
 * never drift: 312 sales pay 757 pesewas and 36 pay 756, which is exactly
 * 263,400.
 */
const PER_SALE = Math.floor(COMMISSION_MINOR / SALES)
const ROUNDED_UP = COMMISSION_MINOR - PER_SALE * SALES
const L1_RATE = 20
const DEMO_PRODUCT_SLUG = 'demo-marketing-sample'

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

/**
 * The demo product and everything hanging off it.
 *
 * ⚠️ THIS RUNS BEFORE THE ACCOUNTS, NOT AFTER. `products.created_by` is a
 * plain foreign key with no ON DELETE, so a product created by the demo user
 * BLOCKS deleting that user. The chain has to come apart from the far end:
 * ledger, conversions, orders, then the product, then the people.
 */
const purgeDemoProduct = async () => {
  await db.query(`alter table public.commission_ledger disable trigger user`)
  await db.query(`delete from public.commission_ledger where idempotency_key like 'demo-%'`)
  await db.query(`alter table public.commission_ledger enable trigger user`)
  await db.query(
    `delete from public.conversions c
      using public.orders o
      where o.id = c.order_id and o.provider_ref like 'demo-sale-%'`,
  )
  await db.query(`delete from public.orders where provider_ref like 'demo-sale-%'`)
  await db.query(
    `delete from public.orders o using public.products p
      where p.id = o.product_id and p.slug = $1`,
    [DEMO_PRODUCT_SLUG],
  )
  await db.query(`delete from public.affiliate_clicks where visitor_token like 'demo-visitor-%'`)
  await db.query(`delete from public.products where slug = $1`, [DEMO_PRODUCT_SLUG])
}

try {
  await purgeDemoProduct()
  for (const email of [EMAIL, BUYER_EMAIL]) await purge(email)

  if (drop) {
    /* Check for the SHAPE of the data, not just the accounts. The rows that
       survive a cleanup are the ones it never knew it wrote. */
    const { rows } = await db.query(
      `select (select count(*) from auth.users where email like '%@demo.invalid') as users,
              (select count(*) from public.orders where provider_ref like 'demo-sale-%') as orders,
              (select count(*) from public.affiliate_clicks
                where visitor_token like 'demo-visitor-%') as clicks,
              (select count(*) from public.commission_ledger
                where idempotency_key like 'demo-%') as ledger,
              (select count(*) from public.products where slug = $1) as products`,
      [DEMO_PRODUCT_SLUG],
    )
    const left = rows[0]
    console.log(
      `done: ${left.users} users, ${left.orders} orders, ${left.clicks} clicks, ` +
        `${left.ledger} ledger rows, ${left.products} products remain`,
    )
    if (Object.values(left).some((n) => Number(n) !== 0)) {
      throw new Error('demo data survived the cleanup')
    }
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

  // ---- The funnel --------------------------------------------------------

  /* What the 348 sales are OF. A draft product never reaches the shop or the
     landing page (both filter on `status = 'published'`), so the demo can have
     something to sell without putting a fictional item in front of anybody. */
  const { rows: demoProduct } = await db.query(
    `insert into public.products
       (slug, title, description, kind, purpose, status, price_minor, created_by)
     values ($1, 'DEMO: Marketing sample (not for sale)',
             'Stands in for the small items an affiliate sells. Draft, so it is never listed.',
             'ebook', 'vendor_product', 'draft', $2, $3)
     on conflict (slug) do update set price_minor = excluded.price_minor
     returning id`,
    [DEMO_PRODUCT_SLUG, (PER_SALE + 1) * (100 / L1_RATE), userId],
  )
  const target = demoProduct[0].id

  /* Clicks, spread over the 30-day window the dashboard counts, with each
     visitor token reused so People comes out below Clicks the way real repeat
     traffic does. `i % VISITORS` yields exactly VISITORS distinct tokens. */
  await db.query(
    `insert into public.affiliate_clicks (affiliate_id, product_id, visitor_token, created_at)
     select $1, $2, 'demo-visitor-' || (i % $4), now() - (interval '1 hour' * (i % 696))
       from generate_series(1, $3) i`,
    [affiliateId, target, CLICKS, VISITORS],
  )

  const { data: buyerAuth, error: buyerError } = await sb.auth.admin.createUser({
    email: BUYER_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Demo Buyer' },
  })
  if (buyerError) throw buyerError

  /* `provider_ref` is the join key between the three inserts below. A bare
     `insert ... returning` gives no promise that the rows come back in the
     order they went in, so pairing an order with its commission by position
     would be pairing them by luck. */
  await db.query(
    `insert into public.orders
       (user_id, product_id, kind, amount_minor, list_price_minor, method, status,
        provider_ref, confirmed_at)
     select $1, $2, 'purchase',
            case when i <= $4::int then $5::bigint else $6::bigint end, $5::bigint,
            'paystack', 'confirmed',
            'demo-sale-' || i,
            /* Across the WHOLE 30-day window, and not evenly.
               The card draws an earnings line over this, so the placement of
               the sales in time IS the shape of that line: bunched at the
               recent end it draws a cliff, spread evenly it draws a ruler.
               The curve puts more of them in recent days, and sin(i) is a
               deterministic jitter that keeps the daily totals from being
               identical. */
            now() - (interval '1 hour' * least(695, greatest(0,
              695 * power(i::numeric / $3::int, 1.8) + 8 * sin(i::numeric)
            )))
       from generate_series(1, $3) i`,
    [
      buyerAuth.user.id,
      target,
      SALES,
      ROUNDED_UP,
      (PER_SALE + 1) * (100 / L1_RATE),
      PER_SALE * (100 / L1_RATE),
    ],
  )

  const { rows: prog2 } = await db.query(`select id from public.affiliate_programs limit 1`)
  await db.query(
    `insert into public.conversions
       (order_id, affiliate_id, program_id, attribution_model, base_minor, l1_rate,
        status, attributed_at, created_at)
     select o.id, $1, $2, 'last_click', o.amount_minor, $3, 'attributed',
            o.confirmed_at, o.confirmed_at
       from public.orders o
      where o.provider_ref like 'demo-sale-%'`,
    [affiliateId, prog2[0].id, L1_RATE],
  )

  /* The commission is derived from the order, not asserted alongside it, so
     the ledger cannot disagree with what was sold. */
  await db.query(
    `insert into public.commission_ledger
       (affiliate_id, conversion_id, entry_type, amount_minor, level, status,
        reason, idempotency_key, created_at)
     select $1, c.id, 'credit', c.base_minor * $2 / 100, 1, 'cleared',
            'Demo sale', 'demo-credit-' || c.id, c.attributed_at
       from public.conversions c
      where c.affiliate_id = $1`,
    [affiliateId, L1_RATE],
  )

  const { rows: check } = await db.query(
    `select (select balance from public.user_balances where user_id = $1) as points,
            public.affiliate_balance_minor($2) as commission,
            (select count(*) from public.affiliate_clicks
              where affiliate_id = $2 and created_at > now() - interval '30 days') as clicks,
            (select count(distinct visitor_token) from public.affiliate_clicks
              where affiliate_id = $2 and created_at > now() - interval '30 days') as people,
            (select count(*) from public.conversions
              where affiliate_id = $2 and status = 'attributed'
                and created_at > now() - interval '30 days') as sales`,
    [userId, affiliateId],
  )
  const row = check[0]
  const rate = ((Number(row.sales) / Number(row.clicks)) * 100).toFixed(1)
  console.log(`seeded ${EMAIL}`)
  console.log(`  points     ${row.points} (GHS ${(Number(row.points) / 100).toFixed(2)})`)
  console.log(`  commission ${row.commission} (GHS ${(Number(row.commission) / 100).toFixed(2)})`)
  console.log(`  funnel     ${row.clicks} clicks / ${row.people} people / ${row.sales} sales / ${rate}%`)
  console.log(`  password   ${PASSWORD}`)

  if (Number(row.commission) !== COMMISSION_MINOR) {
    throw new Error(`commission is ${row.commission}, expected ${COMMISSION_MINOR}`)
  }
  if (Number(row.sales) !== SALES) throw new Error(`sales is ${row.sales}, expected ${SALES}`)
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
