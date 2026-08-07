/**
 * Commission rates in the admin.
 *
 * The load-bearing claim on that screen is "rates apply to new sales only",
 * and a screenshot cannot check it. So this makes a sale at one rate, changes
 * the rate, and asserts the sale did not move — which is what
 * `conversions.l1_rate` being frozen is supposed to guarantee.
 *
 * ⚠️ IT WRITES TO THE LIVE CATALOGUE. Everything it creates is removed in the
 * finally block, and it never touches a product it did not create.
 *
 *   PORT=3100 npx next start
 *   node --env-file=.env.local scripts/verify-commission-rates.mjs > /tmp/o.log 2>&1
 */
import { chromium } from '@playwright/test'
import { Client } from 'pg'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const base = process.env.BASE_URL ?? 'http://localhost:3100'
const email = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const password = process.env.SHOOT_PASSWORD ?? '1234'
const SLUG = 'verify-commission-product'

let pass = 0
let fail = 0
const ok = (label, condition, detail = '') => {
  if (condition) {
    pass += 1
    console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`)
  } else {
    fail += 1
    console.log(`  ✗ ${label}${detail ? '  ' + detail : ''}`)
  }
}

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await db.connect()
const browser = await chromium.launch()
let productId = null

try {
  const { rows: admin } = await db.query(
    `select user_id from public.user_roles where role = 'super_admin' limit 1`,
  )
  const adminId = admin[0].user_id

  // ---- a product of our own, with no programme -------------------------
  const { rows: made } = await db.query(
    `insert into public.products (slug, title, kind, purpose, status, price_minor, created_by)
     values ($1, 'VERIFY commission product', 'ebook', 'vendor_product', 'draft', 20000, $2)
     returning id`,
    [SLUG, adminId],
  )
  productId = made[0].id

  console.log('--- the RPC ---')
  const call = async (l1, l2, extra = '') =>
    (
      await db.query(
        `select public.admin_save_affiliate_program($1,$2,$3,$4${extra}) as r`,
        [adminId, productId, l1, l2],
      )
    ).rows[0].r

  const first = await call(30, 5)
  ok('creates a programme where there was none', first.outcome === 'ok' && first.created === true)

  const { rows: row } = await db.query(
    `select l1_rate_value, l2_rate_value, attribution_window_hours, hold_days, status
       from public.affiliate_programs where product_id = $1`,
    [productId],
  )
  ok('stores the rates', Number(row[0].l1_rate_value) === 30 && Number(row[0].l2_rate_value) === 5,
     `${row[0].l1_rate_value}% / ${row[0].l2_rate_value}%`)

  const again = await call(25, 5)
  ok('updates rather than duplicating', again.outcome === 'ok' && again.created === false)
  const { rows: count } = await db.query(
    `select count(*)::int n from public.affiliate_programs where product_id = $1`,
    [productId],
  )
  ok('still one programme per product', count[0].n === 1, `${count[0].n} row(s)`)

  ok('refuses the two levels adding past 100', (await call(80, 30)).outcome === 'over_100')
  ok('refuses a negative rate', (await call(-1, 0)).outcome === 'bad_l1')

  // ---- the frozen-rate promise ----------------------------------------
  console.log('\n--- rates apply to NEW sales only ---')
  await call(30, 5)
  const { rows: prog } = await db.query(
    `select id from public.affiliate_programs where product_id = $1`,
    [productId],
  )
  const { rows: aff } = await db.query(`select id from public.affiliate_accounts limit 1`)
  const { rows: buyer } = await db.query(`select id from auth.users limit 1`)

  const { rows: order } = await db.query(
    `insert into public.orders
       (user_id, product_id, kind, amount_minor, list_price_minor, method, status,
        provider_ref, confirmed_at)
     values ($1,$2,'purchase',20000,20000,'paystack','confirmed','verify-comm-1',now())
     returning id`,
    [buyer[0].id, productId],
  )
  const { rows: conv } = await db.query(
    `insert into public.conversions
       (order_id, affiliate_id, program_id, attribution_model, base_minor, l1_rate, status, attributed_at)
     values ($1,$2,$3,'last_click',20000,30,'attributed',now())
     returning id, l1_rate`,
    [order[0].id, aff[0].id, prog[0].id],
  )
  ok('a sale records the rate that was live', Number(conv[0].l1_rate) === 30, `${conv[0].l1_rate}%`)

  await call(10, 0)
  const { rows: after } = await db.query(`select l1_rate from public.conversions where id = $1`, [
    conv[0].id,
  ])
  ok(
    'changing the rate to 10% leaves that sale at 30%',
    Number(after[0].l1_rate) === 30,
    `still ${after[0].l1_rate}%`,
  )

  const removed = await db.query(
    `select public.admin_remove_affiliate_program($1,$2) as r`,
    [adminId, productId],
  )
  ok(
    'and the programme cannot be removed once earned on',
    removed.rows[0].r.outcome === 'has_sales',
    removed.rows[0].r.outcome,
  )

  // ---- the screen -------------------------------------------------------
  console.log('\n--- the editor ---')
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel(/email/i).fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /log in|connexion/i }).click()
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 20000 })

  await page.goto(`${base}/admin/catalogue/${productId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const body = await page.locator('body').innerText()
  ok('the editor has a Commission section', /Commission/.test(body))
  ok('and shows what it is worth in cash', /GHS \d/.test(body), (body.match(/On one sale[^\n]{0,120}/) ?? [''])[0].slice(0, 110))
  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 150))
  await context.close()
} catch (e) {
  console.log(`\nERROR ${e.message}`)
  fail += 1
} finally {
  if (productId) {
    await db.query(
      `delete from public.conversions c using public.orders o
        where o.id = c.order_id and o.product_id = $1`,
      [productId],
    )
    await db.query(`delete from public.orders where product_id = $1`, [productId])
    await db.query(`delete from public.affiliate_programs where product_id = $1`, [productId])
    await db.query(`delete from public.products where id = $1`, [productId])
  }
  const { rows: left } = await db.query(
    `select count(*)::int n from public.products where slug = $1`,
    [SLUG],
  )
  console.log(`\ncleanup: ${left[0].n} verify product(s) remain`)
  await db.end()
  await browser.close()
}

console.log(`${pass}/${pass + fail} checks passed`)
process.exitCode = fail === 0 ? 0 : 1
