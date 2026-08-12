/**
 * The two things the operator hit on 2026-08-12: a withdrawal that could not
 * see either of their payout accounts, and an upgrade quoted at full price.
 *
 *   1. TWO DESTINATIONS DO NOT MEAN ZERO. `.maybeSingle()` errors on two rows
 *      and returns null, which the screen read as "none". This is the check
 *      that would have caught it.
 *   2. THE SCREEN OFFERS A CHOICE, and the database is told which one, because
 *      `request_commission_payout` used to select an arbitrary row.
 *   3. ADDING A DESTINATION IS NOT CHANGING ONE, so no cool-off. Only a real
 *      change starts the clock, and re-saving the same details does not.
 *   4. AN UPGRADE COSTS THE DIFFERENCE, WHICHEVER DOOR. `start_training_upgrade`
 *      priced it correctly for weeks while nothing in the product called it, so
 *      this is deliberately checked in three places that must agree: the offer
 *      the screen reads, the order the till actually opens, and the two screens
 *      that quote a price. A unit test on the function would pass through this
 *      bug again — that is how it shipped.
 *
 *   node --env-file=.env.local scripts/verify-payout-destinations.mjs
 *
 * Needs a server on BASE — `npm run build && npx next start -p 3100`.
 *
 * ⚠️ IT TOUCHES LIVE CONFIG AND LIVE PAYOUT DETAILS. It lowers the commission
 * minimum so the form is reachable at all, and adds a second destination to
 * the test admin. Both are restored in the `finally`, which then RE-READS them
 * to prove it. Never pipe this through `head`: SIGPIPE would kill it before
 * that runs. Redirect to a file and tail it.
 *
 * ⚠️ THE UPGRADE HALF BUYS SOMETHING. It creates its own throwaway account and
 * puts a real confirmed order for the cheapest training on it, because an
 * upgrade needs something to upgrade FROM and no existing account may be
 * borrowed for that. The order for the dearer one is opened inside a
 * transaction that is ROLLED BACK, so nothing is ever charged twice.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const BASE = process.env.BASE ?? 'http://localhost:3100'
const EMAIL = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const PASSWORD = process.env.SHOOT_PASSWORD ?? '1234'

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const stamp = Date.now()
const UPGRADE_EMAIL = `upgrade-${stamp}@test.invalid`
const UPGRADE_PASSWORD = `Upgrade!${stamp}`

/** The app's own shape for money, so a check compares like with like:
 *  `GHS 200.00`, always two decimals. See `src/lib/market/money.ts`. */
const cedis = (minor) =>
  `GHS ${(Math.abs(minor) / 100).toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const body = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

let browser = null
let originalMinimum = null
let addedCrypto = false
let userId = null
let upgradeUserId = null

try {
  await db.connect()

  const { rows: who } = await db.query(`select id from auth.users where email = $1`, [EMAIL])
  userId = who[0]?.id
  if (!userId) throw new Error(`No account for ${EMAIL}`)

  /* ---- 3. the cool-off, in the database ------------------------------- */
  const { rows: before } = await db.query(
    `select method::text, last_changed_at, created_at from public.user_payout_details
      where user_id = $1 order by method`,
    [userId],
  )
  check(
    'an existing destination that was only ever added carries no cool-off',
    before.every((r) => r.last_changed_at <= r.created_at),
    before.map((r) => `${r.method}:${r.last_changed_at.toISOString().slice(0, 10)}`).join(', '),
  )

  /* Add a SECOND destination, which is what broke the screen. */
  const { rows: coin } = await db.query(
    `select c.id as coin_id, n.id as network_id
       from public.payout_coins c
       left join public.payout_coin_networks n on n.coin_id = c.id
      where c.is_active order by c.sort_order limit 1`,
  )
  await db.query(
    `select public.set_payout_details($1, 'crypto', $2, $3,
       'TX1cUpZLDGcMEHumtjHT6Q4Vd1YM8pMFbA', null, null, null, null)`,
    [userId, coin[0].coin_id, coin[0].network_id],
  )
  addedCrypto = true

  const { rows: added } = await db.query(
    `select last_changed_at from public.user_payout_details
      where user_id = $1 and method = 'crypto'`,
    [userId],
  )
  check(
    'adding a destination starts no cool-off',
    added[0].last_changed_at.getTime() < Date.now() - 48 * 3600 * 1000,
    added[0].last_changed_at.toISOString(),
  )

  /* Re-save the identical details: still not a change. */
  await db.query(
    `select public.set_payout_details($1, 'crypto', $2, $3,
       'TX1cUpZLDGcMEHumtjHT6Q4Vd1YM8pMFbA', null, null, null, null)`,
    [userId, coin[0].coin_id, coin[0].network_id],
  )
  const { rows: resaved } = await db.query(
    `select last_changed_at from public.user_payout_details
      where user_id = $1 and method = 'crypto'`,
    [userId],
  )
  check(
    're-saving the same details does not restart it',
    resaved[0].last_changed_at.getTime() === added[0].last_changed_at.getTime(),
  )

  /* ---- the form has to be reachable to be looked at -------------------- */
  const { rows: cfg } = await db.query(
    `select value from public.app_config where key = 'commission_payout_minimum_minor'`,
  )
  originalMinimum = cfg[0]?.value ?? null
  await db.query(
    `update public.app_config set value = '100' where key = 'commission_payout_minimum_minor'`,
  )

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })

  /* ---- 1 and 2. the screen -------------------------------------------- */
  await page.goto(`${BASE}/commission/withdraw`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const text = await body(page)

  check(
    'two destinations no longer read as none',
    !/add where to send|payout details/i.test(text),
    text.slice(0, 110),
  )

  const options = await page.locator('input[name="commission-destination"]').count()
  check('both destinations are offered', options === 2, `${options} offered`)

  const checked = await page
    .locator('input[name="commission-destination"]:checked')
    .getAttribute('value')
  check('mobile money is selected on arrival', checked === 'mobile_money', String(checked))

  /* The ads withdrawal reads the same table and must be unaffected. */
  const ads = await page.goto(`${BASE}/withdraw`, { waitUntil: 'networkidle' })
  check('the ads withdrawal still works', ads?.status() === 200, `HTTP ${ads?.status()}`)

  check('no page errors', errors.length === 0, errors.join(' | '))

  /* ---- 4. an upgrade costs the difference, whichever door -------------- */

  const { rows: programmes } = await db.query(
    `select pr.id, pr.slug, tp.commission_depth,
            public.product_price_minor(pr.id) as price_minor
       from public.training_programs tp
       join public.products pr on pr.id = tp.product_id
      where pr.status = 'published'
      order by tp.commission_depth`,
  )
  if (programmes.length < 2) {
    throw new Error(`Needs two published training programmes; found ${programmes.length}`)
  }
  const lower = programmes[0]
  const upper = programmes[programmes.length - 1]

  /* ITS OWN ACCOUNT. An upgrade needs something to upgrade from, and no real
     account may be borrowed to hold it — the test admin already owns the
     dearer programme anyway, so it is offered nothing at all. */
  const { data: made, error: madeError } = await sb.auth.admin.createUser({
    email: UPGRADE_EMAIL,
    password: UPGRADE_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Upgrade Tester' },
  })
  if (madeError) throw madeError
  upgradeUserId = made.user.id

  /* Bought through the real path, not inserted: confirming the order is what
     creates the affiliate account and the entitlement the upgrade reads. */
  const { rows: bought } = await db.query(
    `select id, amount_minor from public.start_product_order($1, $2, 'paystack')`,
    [upgradeUserId, lower.id],
  )
  await db.query(`select public.confirm_product_order($1, $2)`, [
    bought[0].id,
    `verify-upgrade-${stamp}`,
  ])

  const paidMinor = Number(bought[0].amount_minor)
  const expectedMinor = Math.max(Number(upper.price_minor) - paidMinor, 0)

  const { rows: offerRow } = await db.query(`select public.training_upgrade_offer($1) as offer`, [
    upgradeUserId,
  ])
  const offer = offerRow[0].offer
  check(
    'the offer prices the difference, not the list price',
    offer?.product_id === upper.id && Number(offer?.upgrade_minor) === expectedMinor,
    `upgrade_minor=${offer?.upgrade_minor} list=${offer?.price_minor} expected=${expectedMinor}`,
  )

  /* ⚠️ THE TILL, NOT THE OFFER. The bug was never in the arithmetic — it was
     that the ordinary purchase path never ran it. So this opens a real order
     through `start_product_order`, the function the Buy button calls, and
     rolls it back. Nothing is charged. */
  await db.query('begin')
  const { rows: dry } = await db.query(
    `select kind::text as kind, amount_minor
       from public.start_product_order($1, $2, 'paystack')`,
    [upgradeUserId, upper.id],
  )
  await db.query('rollback')
  check(
    'the buy button opens an UPGRADE order at the difference',
    dry[0].kind === 'training_upgrade' && Number(dry[0].amount_minor) === expectedMinor,
    `${dry[0].kind} @ ${dry[0].amount_minor}, expected training_upgrade @ ${expectedMinor}`,
  )

  /* Its own context: a second signed-in account cannot share the admin's. */
  const upCtx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true })
  const upPage = await upCtx.newPage()
  const upErrors = []
  upPage.on('pageerror', (e) => upErrors.push(e.message))

  await upPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await upPage.getByLabel(/email/i).fill(UPGRADE_EMAIL)
  await upPage.locator('input[type="password"]').fill(UPGRADE_PASSWORD)
  await upPage.getByRole('button', { name: /log in/i }).click()
  await upPage.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })

  await upPage.goto(`${BASE}/p/${upper.slug}`, { waitUntil: 'networkidle' })
  const headline = (await upPage.locator('span.tabular-nums.font-bold').first().innerText()).trim()
  check(
    'the product page quotes the difference',
    headline === cedis(expectedMinor),
    `${headline}, expected ${cedis(expectedMinor)}`,
  )

  const struck = (await upPage.locator('.line-through').first().innerText().catch(() => '')).trim()
  check(
    'with the full price struck through beside it',
    struck === cedis(Number(upper.price_minor)),
    `${struck || 'nothing struck through'}, expected ${cedis(Number(upper.price_minor))}`,
  )

  const productText = await body(upPage)
  check('and a line saying why it is lower', /only pay the difference/i.test(productText))

  /* The panel that sells the upgrade. Its button carried the list price. */
  await upPage.goto(`${BASE}/market/account`, { waitUntil: 'networkidle' })
  const cta = (
    await upPage
      .getByRole('link', { name: /upgrade for/i })
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ')
  check(
    'the upgrade panel button quotes the difference',
    cta.includes(cedis(expectedMinor)),
    `${cta || 'no upgrade link'}, expected ${cedis(expectedMinor)}`,
  )

  check('no page errors on the upgrade screens', upErrors.length === 0, upErrors.join(' | '))
} catch (error) {
  check('the run completed', false, error.message)
} finally {
  if (browser) await browser.close()

  try {
    if (originalMinimum !== null) {
      await db.query(
        `update public.app_config set value = $1 where key = 'commission_payout_minimum_minor'`,
        [originalMinimum],
      )
    }
    if (addedCrypto && userId) {
      await db.query(
        `delete from public.user_payout_details where user_id = $1 and method = 'crypto'`,
        [userId],
      )
      await db.query(`delete from public.payout_detail_changes where user_id = $1`, [userId])
    }

    /* The upgrade fixture, in dependency order: an entitlement points at an
       order, and the commission ledger is append-only by trigger exactly like
       the points one, so it cannot be deleted without turning that off. */
    if (upgradeUserId) {
      const affiliates = `(select id from public.affiliate_accounts where user_id = $1)`
      await db.query(
        `delete from public.affiliate_entitlements where affiliate_id in ${affiliates}`,
        [upgradeUserId],
      )
      await db.query(
        `delete from public.conversions
          where order_id in (select id from public.orders where user_id = $1)`,
        [upgradeUserId],
      )
      await db.query(`delete from public.entitlements where user_id = $1`, [upgradeUserId])
      await db.query(`delete from public.orders where user_id = $1`, [upgradeUserId])
      await db.query(`alter table public.commission_ledger disable trigger user`)
      await db.query(`delete from public.commission_ledger where affiliate_id in ${affiliates}`, [
        upgradeUserId,
      ])
      await db.query(`alter table public.commission_ledger enable trigger user`)
      await db.query(`delete from public.affiliate_accounts where user_id = $1`, [upgradeUserId])
      for (const table of ['user_balances', 'notifications', 'fraud_signals']) {
        await db.query(`delete from public.${table} where user_id = $1`, [upgradeUserId])
      }
      await db.query(`delete from auth.users where id = $1`, [upgradeUserId])
    }

    /* Re-read rather than trust the writes above. A restore that silently
       failed would leave a live money setting changed. */
    const { rows } = await db.query(
      `select (select value from public.app_config
                where key = 'commission_payout_minimum_minor') as minimum,
              (select count(*)::int from public.user_payout_details
                where user_id = $1 and method = 'crypto') as leftover,
              (select count(*)::int from auth.users where id = $2) as fixture,
              (select count(*)::int from pg_trigger
                where tgrelid = 'public.commission_ledger'::regclass
                  and tgenabled <> 'O' and not tgisinternal) as disabled_triggers`,
      [userId, upgradeUserId],
    )
    console.log(
      `cleanup: minimum=${rows[0].minimum}, crypto rows left=${rows[0].leftover}, ` +
        `fixtures left=${rows[0].fixture}, disabled trigger(s)=${rows[0].disabled_triggers}`,
    )
    if (
      rows[0].minimum !== originalMinimum ||
      rows[0].leftover !== 0 ||
      rows[0].fixture !== 0 ||
      rows[0].disabled_triggers !== 0
    ) {
      process.exitCode = 1
    }
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message)
    process.exitCode = 1
  }
  await db.end()

  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length}`)
  if (passed !== results.length) process.exitCode = 1
}
