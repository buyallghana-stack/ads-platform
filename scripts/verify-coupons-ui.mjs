/**
 * Coupons, driven through the real screens.
 *
 * The rules are covered by 22 tests in `tests/money/coupons.test.ts` and
 * `tests/affiliate/coupons.test.ts`. What no test can see is the thing that
 * has gone wrong three times on this project's admin screens: a page that
 * renders nothing below `lg` (blank on a phone), a nested table that throws
 * hydration #418, and a form whose refusal never reaches the operator.
 *
 * So this presses the buttons:
 *
 *   1. THE SECTION EXISTS AND LOADS, with no page error of any kind.
 *   2. A COUPON CAN BE CREATED FROM THE FORM, and shows up in the list with
 *      its quota.
 *   3. THE FORM SAYS WHAT THE DISCOUNT IS WORTH, at both ends of the band,
 *      because "50% off Platinum" is two different numbers and the operator is
 *      choosing between them without knowing it.
 *   4. THE COMMISSION GUARD REACHES THE SCREEN. It is the only thing standing
 *      between the operator's own rule and a ledger that pays out more than it
 *      takes, and a guard that only exists in SQL is one the operator meets
 *      after typing everything in.
 *   5. A COUPON WITH NO TARGET CANNOT BE SAVED, which is the operator's rule.
 *   6. IT IS NOT BLANK ON A PHONE, and does not scroll sideways at 320.
 *   7. A SHARED LINK WORKS: /upgrade?coupon=CODE fills the box, applies the
 *      code and shows the reduced price before anybody pays.
 *
 *   node --env-file=.env.local scripts/verify-coupons-ui.mjs
 *
 * Needs a server on BASE — `npm run build && npx next start -p 3100`.
 * ⚠️ `pkill -f "next start"` does NOT kill that server. Take the pid from
 * `ss -ltnp` or a stale one will answer and fake a pass by not hydrating.
 *
 * It writes coupon rows and deletes them in the `finally`. Nothing else on the
 * platform is touched: quoting a code reserves nothing, so no purchase, no
 * payment and no redemption is created by this run.
 */
import { chromium } from '@playwright/test'
import { Client } from 'pg'

/* Never let a closed stdout kill the run before the cleanup. Redirect to a
   file and tail it rather than piping this through `head`. */
process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const BASE = process.env.BASE ?? 'http://localhost:3100'
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

const stamp = Date.now().toString(36).toUpperCase()
const CODE = `VERIFY${stamp}`
const codes = [CODE]

const body = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

let browser = null

try {
  await db.connect()

  const { rows: tiers } = await db.query(
    `select name, price_minor, band_max_minor from public.tiers where slug = 'platinum'`,
  )
  const platinum = tiers[0]
  if (!platinum) throw new Error('No Platinum plan on this project')

  const { rows: training } = await db.query(
    `select p.title, ap.l1_rate_value + ap.l2_rate_value as pays
       from public.products p
       join public.affiliate_programs ap on ap.product_id = p.id
      where p.purpose = 'training_program' and ap.status = 'active'
      order by p.price_minor limit 1`,
  )

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    /* Hydration mismatches arrive as console errors, not page errors. #418 and
       #423 are the two that a nested table produces. */
    if (m.type() === 'error' && /Minified React error|hydrat/i.test(m.text())) {
      errors.push(m.text())
    }
  })

  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/admin/, { timeout: 30_000 })

  /* ---- 1. the section exists ------------------------------------------- */
  const navLink = page.locator('a[href$="/admin/coupons"]').first()
  check('the admin sidebar has a Coupons destination', (await navLink.count()) > 0)

  const response = await page.goto(`${BASE}/admin/coupons`, { waitUntil: 'networkidle' })
  check('/admin/coupons loads', response?.status() === 200, `HTTP ${response?.status()}`)

  const text = await body(page)
  check('the screen explains that a coupon names its target', /names the plan or programme/i.test(text))

  /* ---- 2 and 3. the form, and what it says the discount is worth -------- */
  await page.getByRole('button', { name: /new coupon/i }).click()

  const targetSelect = page.locator('select').first()
  await targetSelect.selectOption({ label: platinum.name })
  await page.getByPlaceholder('LAUNCH50').fill(CODE)

  const percentBox = page.locator('input[type="number"]').first()
  await percentBox.fill('50')

  const afterPercent = await body(page)
  const floorOff = ((platinum.price_minor * 0.5) / 100).toFixed(2)
  check(
    'the form works out what the discount is worth at the floor of the band',
    afterPercent.includes(`GHS ${floorOff}`),
    `expected GHS ${floorOff}`,
  )

  if (platinum.band_max_minor) {
    const topOff = ((platinum.band_max_minor * 0.5) / 100).toFixed(2)
    check(
      'and at the top of it, where every coupon holder will buy',
      afterPercent.includes(`GHS ${topOff}`) && /worth most/i.test(afterPercent),
      `expected GHS ${topOff}`,
    )
  }

  /* The cash cap is the operator's brake on that. */
  const capBox = page.locator('input[type="number"]').nth(1)
  await capBox.fill('300')
  const capped = await body(page)
  check(
    'a cash cap changes the figure it quotes',
    capped.includes('GHS 300.00'),
    'cap of GHS 300 applied to both ends',
  )

  await page.getByRole('button', { name: /create coupon/i }).click()
  await page.waitForLoadState('networkidle')

  /* Polled on the page TEXT rather than waiting for an element. The code is
     rendered twice, in the phone card list and in the table, and exactly one
     of those is display:none at any width — so waiting for "the first match to
     become visible" waits on the hidden one and times out while the row is
     plainly on screen. */
  let listed = ''
  for (let i = 0; i < 30 && !listed.includes(CODE); i += 1) {
    await page.waitForTimeout(500)
    listed = await body(page)
  }
  const appeared = listed.includes(CODE)
  check('the coupon appears in the list without a reload', appeared, listed.slice(0, 200))
  check('with its quota', /0 of 100/.test(listed))

  const { rows: saved } = await db.query(
    `select business, discount_kind, percent::text, max_discount_minor, first_purchase_only, per_user_limit
       from public.coupons where code = $1`,
    [CODE],
  )
  check(
    'the row is what the form said it was',
    saved.length === 1 &&
      saved[0].business === 'ads' &&
      saved[0].discount_kind === 'percent' &&
      Number(saved[0].percent) === 50 &&
      Number(saved[0].max_discount_minor) === 30_000 &&
      saved[0].first_purchase_only === true &&
      saved[0].per_user_limit === 1,
    JSON.stringify(saved[0] ?? null),
  )

  /* ---- 4. the commission guard reaches the operator --------------------- */
  if (training[0]) {
    await page.getByRole('button', { name: /new coupon/i }).first().click()
    await page.getByRole('radio', { name: /affiliate/i }).click()
    await page.locator('select').first().selectOption({ label: training[0].title })
    await page.getByPlaceholder('LAUNCH50').fill(`GUARD${stamp}`)
    await page.locator('input[type="number"]').first().fill('90')

    const guarded = await body(page)
    const most = 100 - Number(training[0].pays)
    check(
      'a discount deeper than the commission is refused on the screen, not only in SQL',
      /pay out more than the sale brings in/i.test(guarded) && guarded.includes(`${most} percent`),
      `names ${most} percent`,
    )

    const saveButton = page.getByRole('button', { name: /create coupon/i })
    check('and the save button is not offered', await saveButton.isDisabled())

    /* ---- 5. no target, no coupon --------------------------------------- */
    await page.locator('input[type="number"]').first().fill('10')
    await page.locator('select').first().selectOption('')
    check(
      'a coupon with no target cannot be saved',
      await page.getByRole('button', { name: /create coupon/i }).isDisabled(),
    )

    await page.getByRole('button', { name: /cancel/i }).last().click()
  }

  /* ---- 6. not blank on a phone ----------------------------------------- */
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 850 })
    await page.goto(`${BASE}/admin/coupons`, { waitUntil: 'networkidle' })

    const visible = await page.getByText(CODE, { exact: false }).first().isVisible()
    check(`the coupon is visible at ${width}px`, visible)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    check(`no sideways scroll at ${width}px`, overflow <= 0, `${overflow}px over`)
  }

  /* ---- 7. the shared link ---------------------------------------------- */
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${BASE}/upgrade?coupon=${CODE}`, { waitUntil: 'networkidle' })

  const getPlan = page.getByRole('button', { name: new RegExp(`Get ${platinum.name}`, 'i') }).first()
  if ((await getPlan.count()) > 0) {
    await getPlan.click()
    await page.waitForTimeout(800)

    /* A band explains itself once before the checkout: "you choose what to
       pay", with Set my amount or Continue at the floor. The sheet is behind
       it, so a run that skipped this would report an empty checkout and look
       like a coupon bug. */
    const carryOn = page.getByRole('button', { name: /continue at/i }).first()
    if ((await carryOn.count()) > 0) {
      await carryOn.click()
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(1500)

    const sheet = await body(page)
    check(
      'a shared link applies the code on arrival',
      new RegExp(`${CODE}[^A-Z]*applied`, 'i').test(sheet),
      sheet.match(/[A-Z0-9]+ applied[^.]*/)?.[0] ?? 'not applied',
    )

    /* Half of the floor price, or the cap, whichever is smaller. Writing the
       cap in here instead was wrong: at GHS 520 the percentage has not reached
       GHS 300 yet, so the cap does not bite. */
    const off = Math.min(Math.floor(platinum.price_minor * 0.5), 30_000)
    const chargeable = ((platinum.price_minor - off) / 100).toFixed(2)
    check(
      'and the price shown is the discounted one',
      sheet.includes(chargeable) || sheet.includes(chargeable.replace('.00', '')),
      `expected ${chargeable}`,
    )
    check(
      'while saying the plan itself is unchanged',
      /still .* in full/i.test(sheet),
      'the discount reduces the price, not the plan',
    )
  } else {
    check('the upgrade screen offers the plan', false, 'no Get button found')
  }

  check('no page or hydration errors anywhere in the run', errors.length === 0, errors.join(' | '))
} catch (error) {
  check('the run completed', false, error.message)
} finally {
  if (browser) await browser.close()

  try {
    const { rowCount } = await db.query(
      `delete from public.coupons where code = any($1) or code like 'GUARD%' or code like 'VERIFY%'`,
      [codes],
    )
    const { rows } = await db.query(
      `select count(*)::int as left from public.coupons where code like 'VERIFY%' or code like 'GUARD%'`,
    )
    console.log(`cleanup: ${rowCount} coupon(s) removed, ${rows[0].left} left behind`)
    if (rows[0].left !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message)
    process.exitCode = 1
  }
  await db.end()

  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length}`)
  if (passed !== results.length) process.exitCode = 1
}
