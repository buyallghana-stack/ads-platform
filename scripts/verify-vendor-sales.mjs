/**
 * The vendor settlement report, driven through the real screen.
 *
 * Decision A3 says settlement is a CSV the admin exports and sends by hand.
 * Nothing existed: no report, no export. So this run builds a vendor with a
 * known history — a full-price sale, a discounted sale, a refunded sale, and
 * an affiliate commission on one of them — and checks that the screen states
 * the same arithmetic the database does, in both places it is stated (the
 * table and the file).
 *
 *   gross − refunded − commission = net
 *
 * ── WHY THE FIXTURE IS THE POINT ──
 *
 * There are no vendors and no vendor products on this project yet, so the
 * screen renders its empty state and every assertion about a number would pass
 * vacuously. A report nobody has seen with data in it is a report nobody has
 * tested. The fixture is torn down afterwards.
 *
 * ── AND WHAT MUST NOT BE THERE ──
 *
 * Decision A4: the system never tracks money owed to a vendor. The screen must
 * not print an "owed" figure anywhere, because no licence terms exist in the
 * schema for one to be computed from. That is asserted too.
 *
 *   node --env-file=.env.local scripts/verify-vendor-sales.mjs
 *
 * Needs a server on BASE — `npm run build && npx next start -p 3100`.
 */
import { chromium } from '@playwright/test'
import { Client } from 'pg'

/* ⚠️ Never let a closed stdout kill this run — see verify-commission-admin. */
process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? ''
const ADMIN_EMAIL = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const ADMIN_PASSWORD = process.env.SHOOT_PASSWORD ?? '1234'

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const stamp = Date.now()
const VENDOR = `Verify Vendor ${stamp}`

/* The history, chosen so every column is a different number and no two can be
   confused if one is wired to the wrong place:
     full price   GHS 200.00 paid, 200.00 list
     discounted   GHS 150.00 paid, 200.00 list
     refunded     GHS 200.00 paid, then refunded
   commission     GHS  30.00 credited on the discounted sale, 10.00 reversed  */
const FULL = 20_000
const DISCOUNTED = 15_000
const LIST = 20_000
const REFUNDED = 20_000
const COMMISSION_CREDIT = 3_000
const COMMISSION_REVERSAL = -1_000

const EXPECT = {
  gross: FULL + DISCOUNTED,
  refunded: REFUNDED,
  commission: COMMISSION_CREDIT + COMMISSION_REVERSAL,
  get net() {
    return this.gross - this.refunded - this.commission
  },
}

const ghs = (minor) => `GHS ${(minor / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

let vendorId = null
let productId = null
let affiliateId = null
let programId = null
let buyerId = null
const orderIds = []
let browser = null

await db.connect()

try {
  /* ---- the fixture ------------------------------------------------------ */
  const { rows: admin } = await db.query(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  if (!admin.length) throw new Error('no super admin on this project to own the fixture')

  const { rows: v } = await db.query(
    `insert into public.vendors (name, status, created_by) values ($1, 'active', $2) returning id`,
    [VENDOR, admin[0].id],
  )
  vendorId = v[0].id

  const { rows: p } = await db.query(
    `insert into public.products
       (vendor_id, kind, purpose, title, slug, price_minor, status, published_at, created_by)
     values ($1, 'ebook', 'vendor_product', $2, $3, $4, 'published', now(), $5)
     returning id`,
    [vendorId, `Verify Product ${stamp}`, `verify-product-${stamp}`, LIST, admin[0].id],
  )
  productId = p[0].id

  /* Every conversion belongs to a program (`conversions.program_id` is NOT
     NULL), so the product needs one before anything can be attributed to it. */
  const { rows: prog } = await db.query(
    `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value)
     values ($1, 30, 10) returning id`,
    [productId],
  )
  programId = prog[0].id

  /* A buyer, and an affiliate whose commission the report must deduct. */
  const { rows: anyUser } = await db.query(`select id from auth.users limit 1`)
  buyerId = anyUser[0].id

  const { rows: anyAffiliate } = await db.query(
    `select id from public.affiliate_accounts limit 1`,
  )
  affiliateId = anyAffiliate.length ? anyAffiliate[0].id : null

  const order = async (amount, list, refunded) => {
    const { rows } = await db.query(
      `insert into public.orders
         (user_id, product_id, kind, amount_minor, list_price_minor, method, status,
          confirmed_at, refunded_at)
       values ($1, $2, 'purchase', $3, $4, 'paystack', $5, now(), $6)
       returning id`,
      [buyerId, productId, amount, list, refunded ? 'refunded' : 'confirmed', refunded ? new Date() : null],
    )
    orderIds.push(rows[0].id)
    return rows[0].id
  }

  await order(FULL, LIST, false)
  const discounted = await order(DISCOUNTED, LIST, false)
  await order(REFUNDED, LIST, true)

  if (affiliateId) {
    /* Status is 'attributed', not 'cleared' — conversion_status is
       (attributed, reversed), while 'cleared' belongs to commission_status.
       Two enums, two vocabularies, and it is the ledger row below that
       carries the money's state. */
    const { rows: conv } = await db.query(
      `insert into public.conversions
         (order_id, affiliate_id, program_id, attribution_model, base_minor, l1_rate, status)
       values ($1, $2, $3, 'last_click', $4, 30, 'attributed') returning id`,
      [discounted, affiliateId, programId, DISCOUNTED],
    )
    for (const [amount, kind, key] of [
      [COMMISSION_CREDIT, 'credit', `verify-vendor-credit-${stamp}`],
      [COMMISSION_REVERSAL, 'reversal', `verify-vendor-reversal-${stamp}`],
    ]) {
      /* `commission_credit_shape` requires a level on a credit — the ledger
         refuses a commission row that cannot say which level earned it. */
      await db.query(
        `insert into public.commission_ledger
           (affiliate_id, conversion_id, entry_type, amount_minor, level, status, reason,
            idempotency_key)
         values ($1, $2, $3, $4, 1, 'cleared', 'verify-vendor-sales', $5)`,
        [affiliateId, conv[0].id, kind, amount, key],
      )
    }
  }

  /* ---- what the database says ------------------------------------------- */
  const { rows: report } = await db.query(
    `select public.admin_vendor_sales_report(now() - interval '1 day', now() + interval '1 day') as j`,
  )
  const mine = (report[0].j.vendors ?? []).find((r) => r.name === VENDOR)
  check('the report returns the vendor', Boolean(mine), mine ? mine.name : 'missing')
  check(
    'gross counts what buyers actually paid, not the list price',
    Number(mine?.gross_minor) === EXPECT.gross,
    `${mine?.gross_minor} vs ${EXPECT.gross}`,
  )
  check(
    'and carries the list price beside it, so a discount is visible',
    Number(mine?.list_minor) === LIST * 2,
    `${mine?.list_minor} vs ${LIST * 2}`,
  )
  check(
    'a refunded sale is deducted, not hidden',
    Number(mine?.refunded_minor) === EXPECT.refunded && Number(mine?.refunded_units) === 1,
    `${mine?.refunded_minor} over ${mine?.refunded_units} unit(s)`,
  )
  check(
    'commission is net of the reversal',
    Number(mine?.commission_minor) === (affiliateId ? EXPECT.commission : 0),
    `${mine?.commission_minor} vs ${affiliateId ? EXPECT.commission : 0}`,
  )
  check(
    'and the row reconciles: gross − refunded − commission = net',
    Number(mine?.net_minor) ===
      Number(mine?.gross_minor) - Number(mine?.refunded_minor) - Number(mine?.commission_minor),
    `${mine?.net_minor}`,
  )
  check(
    'the refunded unit is out of the sales count',
    Number(mine?.units) === 2,
    `${mine?.units} unit(s)`,
  )

  /* ---- what the screen says --------------------------------------------- */
  browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/admin/, { timeout: 30_000 })

  /* The link on Finance is the only door — if it is gone, the screen is
     unreachable however well it renders. */
  await page.goto(`${BASE}/admin/finance`, { waitUntil: 'networkidle' })
  const door = page.locator('a[href$="/admin/finance/vendors"]')
  check('Finance carries the way in to vendor sales', (await door.count()) > 0, 'link present')
  await door.first().click()
  await page.waitForURL(/\/admin\/finance\/vendors/, { timeout: 15_000 })

  await page.getByRole('link', { name: /All time/i }).click()
  await page.waitForTimeout(1_200)
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ')

  check('the vendor is on the screen', text.includes(VENDOR), VENDOR)
  check(
    'with what buyers paid',
    text.includes(ghs(EXPECT.gross)),
    text.match(new RegExp(`${ghs(EXPECT.gross)}`)) ? ghs(EXPECT.gross) : 'not shown',
  )
  check(
    'and what is left after refunds and commission',
    text.includes(ghs(EXPECT.net)),
    ghs(EXPECT.net),
  )
  /* A4. Not "the word never appears" — the note deliberately says "not an
     amount owed", which is the screen doing its job. What must not exist is a
     LABELLED FIGURE: a column header or a card label promising one, because
     that is what an operator would read a number off and pay. */
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('th, dt')].map((el) => el.textContent?.trim() ?? ''),
  )
  const owedLabel = labels.find((l) => /owed|payable|due/i.test(l))
  check(
    'no column or label offers a figure as what the vendor is owed',
    !owedLabel,
    owedLabel ?? `${labels.length} labels, none of them "owed"`,
  )
  check(
    'the screen says why that number is absent',
    /licence agreement/i.test(text),
    'note present',
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/vendor-sales.png`, fullPage: true })

  /* ---- the CSV, which is the actual deliverable ------------------------- */
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.getByRole('button', { name: /Export CSV/i }).click(),
  ])
  const stream = await download.createReadStream()
  const csv = await new Promise((resolve, reject) => {
    let out = ''
    stream.on('data', (c) => (out += c))
    stream.on('end', () => resolve(out))
    stream.on('error', reject)
  })

  const lines = csv.trim().split(/\r?\n/)
  const row = lines.find((l) => l.includes(VENDOR))
  check('the export downloads a file', download.suggestedFilename().endsWith('.csv'), download.suggestedFilename())
  check('with a header naming every column', lines[0].startsWith('vendor,status,'), lines[0])
  check('and a line for the vendor', Boolean(row), row ?? 'missing')
  check(
    'carrying the same figures as the screen, in major units',
    Boolean(row) &&
      row.includes((EXPECT.gross / 100).toFixed(2)) &&
      row.includes((EXPECT.net / 100).toFixed(2)),
    row,
  )
  check(
    'and the vendor name quoted, so a comma cannot shift a column',
    Boolean(row) && row.startsWith(`"${VENDOR}"`),
    row?.slice(0, 40),
  )

  /* ---- and it exists on a phone ----------------------------------------- */
  await page.setViewportSize({ width: 390, height: 900 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const narrow = await page.evaluate(() => ({
    rows: document.querySelectorAll('main li').length,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  check('the report still has its rows at 390px', narrow.rows >= 1, `${narrow.rows} card(s)`)
  check(
    'and does not scroll sideways at 390px',
    narrow.scrollWidth <= narrow.clientWidth + 1,
    `${narrow.scrollWidth} vs ${narrow.clientWidth}`,
  )

  check('no page errors', errors.length === 0, errors[0])

  console.log('')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  try {
    if (orderIds.length) {
      await db.query(`alter table public.commission_ledger disable trigger user`)
      await db.query(
        `delete from public.commission_ledger
          where conversion_id in (select id from public.conversions where order_id = any($1))`,
        [orderIds],
      )
      await db.query(`alter table public.commission_ledger enable trigger user`)
      await db.query(`delete from public.conversions where order_id = any($1)`, [orderIds])
      await db.query(`delete from public.entitlements where order_id = any($1)`, [orderIds]).catch(() => {})
      await db.query(`delete from public.orders where id = any($1)`, [orderIds])
    }
    if (programId) await db.query(`delete from public.affiliate_programs where id = $1`, [programId])
    if (productId) await db.query(`delete from public.products where id = $1`, [productId])
    if (vendorId) await db.query(`delete from public.vendors where id = $1`, [vendorId])

    const { rows } = await db.query(
      `select (select count(*)::int from public.vendors where name = $1) vendors,
              (select count(*)::int from public.orders where id = any($2)) orders,
              (select count(*)::int from pg_trigger
                where tgrelid = 'public.commission_ledger'::regclass
                  and tgenabled <> 'O' and not tgisinternal) disabled_triggers`,
      [VENDOR, orderIds.length ? orderIds : [null]],
    )
    console.log(
      `cleanup: ${rows[0].vendors} vendor(s), ${rows[0].orders} order(s), ${rows[0].disabled_triggers} disabled trigger(s)`,
    )
    if (rows[0].vendors !== 0 || rows[0].orders !== 0 || rows[0].disabled_triggers !== 0) {
      process.exitCode = 1
    }
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| vendor:', vendorId, '| product:', productId)
    process.exitCode = 1
  }
  await db.end()
}
