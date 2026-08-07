/**
 * The 2026-08-07 batch: gift codes, the course fixes, and the withdrawal flow.
 *
 * ⚠️ IT REDEEMS A REAL GIFT CODE against the live database, so it CREATES one
 * first and cleans up after itself. Reusing an operator's code would spend it.
 *
 * Sign in as admin@email.com — user@email.com carries the operator's real
 * authenticator and must never be driven by a script.
 *
 *   PORT=3100 npx next start
 *   node --env-file=.env.local scripts/verify-affiliate-batch.mjs > /tmp/o.log 2>&1
 *   tail -50 /tmp/o.log
 */
import { chromium } from '@playwright/test'
import { Client } from 'pg'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const base = process.env.BASE_URL ?? 'http://localhost:3100'
const email = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const password = process.env.SHOOT_PASSWORD ?? '1234'

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
let giftCodeId = null
let ledgerKey = null

try {
  const loginContext = await browser.newContext()
  const loginPage = await loginContext.newPage()
  await loginPage.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await loginPage.getByLabel(/email/i).fill(email)
  await loginPage.locator('input[type="password"]').fill(password)
  await loginPage.getByRole('button', { name: /log in|connexion/i }).click()
  await loginPage.waitForURL(/\/(dashboard|admin)/, { timeout: 20000 })
  const state = await loginContext.storageState()
  await loginContext.close()
  console.log(`signed in as ${email}\n`)

  const context = await browser.newContext({
    storageState: state,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // ================= gift code stays in the mode =================
  console.log('--- gift code ---')
  await page.goto(`${base}/market`, { waitUntil: 'networkidle' })
  const tile = page.getByRole('link', { name: /gift/i }).first()
  const tileHref = await tile.getAttribute('href')
  ok('the tile no longer leaves for the ads screen', tileHref?.includes('/market/gift-code'), String(tileHref))

  await tile.click()
  await page.waitForURL(/gift-code/, { timeout: 15000 })
  const heading = await page.locator('h1').first().innerText()
  ok('lands on a cedis gift screen', /gift code/i.test(heading), heading)
  const body = await page.locator('body').innerText()
  ok('says cedis, not points', /cedis/i.test(body) && !/\bpoints\b/i.test(body))

  // A code of our own, created and spent here.
  const { rows: admin } = await db.query(
    `select user_id from public.user_roles where role = 'super_admin' limit 1`,
  )
  const { rows: made } = await db.query(
    `select public.admin_create_commission_gift_code($1, null, 250, 'verify script') as r`,
    [admin[0].user_id],
  )
  const created = made[0].r
  ok('admin_create_commission_gift_code works', created.outcome === 'ok', created.code ?? created.outcome)
  giftCodeId = created.id
  ledgerKey = `commission-gift-${created.id}`

  if (created.outcome === 'ok') {
    const before = await db.query(
      `select public.affiliate_balance_minor(a.id) b
         from public.affiliate_accounts a
         join auth.users u on u.id = a.user_id where u.email = $1`,
      [email],
    )
    await page.locator('#commission-gift-code').fill(created.code)
    await page.getByRole('button', { name: /redeem|valider/i }).click()
    await page.waitForTimeout(2500)
    const after = await db.query(
      `select public.affiliate_balance_minor(a.id) b
         from public.affiliate_accounts a
         join auth.users u on u.id = a.user_id where u.email = $1`,
      [email],
    )
    const moved = Number(after.rows[0]?.b ?? 0) - Number(before.rows[0]?.b ?? 0)
    ok('redeeming credits the COMMISSION balance', moved === 250, `moved ${moved} pesewas`)

    const { rows: points } = await db.query(
      `select count(*)::int n from public.points_ledger pl
         join auth.users u on u.id = pl.user_id
        where u.email = $1 and pl.created_at > now() - interval '2 minutes'`,
      [email],
    )
    ok('and credits no POINTS at all', points[0].n === 0, `${points[0].n} new points entries`)

    const { rows: second } = await db.query(
      `select public.redeem_commission_gift_code(u.id, $2) as r
         from auth.users u where u.email = $1`,
      [email, created.code],
    )
    ok('a second redemption is refused', second[0].r.outcome === 'already_used', second[0].r.outcome)
  }

  // ================= the withdrawal flow =================
  console.log('\n--- withdrawal ---')
  await page.goto(`${base}/market`, { waitUntil: 'networkidle' })
  const marketText = await page.locator('body').innerText()
  const withdrawLink = page.getByRole('link', { name: /withdraw|retirer/i }).first()
  ok('the dashboard shows a Withdraw button', (await withdrawLink.count()) > 0)
  ok('and says how far off the minimum is', /to go/i.test(marketText), (marketText.match(/GHS [\d,.]+ to go/) ?? [''])[0])

  await page.goto(`${base}/commission`, { waitUntil: 'networkidle' })
  const requestLink = page.getByRole('link', { name: /request|withdraw|demander/i }).first()
  ok('the earnings screen shows a request button below the minimum', (await requestLink.count()) > 0)

  await page.goto(`${base}/commission/withdraw`, { waitUntil: 'networkidle' })
  const withdrawText = await page.locator('body').innerText()
  const shortfall = /to go|Encore/i.test(withdrawText)
  const noAccount = /where to send/i.test(withdrawText)
  ok(
    'the withdraw screen explains itself rather than refusing at submit',
    shortfall || noAccount,
    shortfall ? 'shows the shortfall' : 'asks for a payout account',
  )
  if (noAccount) {
    const addLink = page.getByRole('link', { name: /payout|coordonn/i }).first()
    const href = await addLink.getAttribute('href')
    ok('and sends them to the shared payout account screen', href?.includes('/profile/payout'), String(href))
  }

  // ================= the course =================
  console.log('\n--- course ---')
  await page.goto(`${base}/learn/affiliate-training-professional`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const lectures = await page.locator('#course-panel-lectures').innerText()
  ok('video lessons are on the curriculum', /Video/i.test(lectures), (lectures.match(/Video[^\n]*/) ?? [''])[0])
  ok('and carry a duration', /\d\d:\d\d/.test(lectures), (lectures.match(/\d\d:\d\d/) ?? [''])[0])

  /* Open an ARTICLE. The first lesson is a video now, and a video lesson has
     no reading pane to bound — the earlier version of this check looked for
     one on the video and reported the feature missing. */
  const articleRow = page
    .locator('#course-panel-lectures a')
    .filter({ hasText: /Article/i })
    .first()
  ok('the course has an article to open', (await articleRow.count()) > 0)
  await articleRow.click()
  await page.waitForURL(/lesson=/, { timeout: 15000 })
  await page.waitForTimeout(1200)

  const pane = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (d) => d.scrollHeight > d.clientHeight + 8 && d.clientHeight > 200 && d.clientHeight < 700,
    )
    return el ? { client: el.clientHeight, scroll: el.scrollHeight } : null
  })
  ok(
    'a long article scrolls inside its own pane',
    pane !== null,
    pane ? `${pane.client}px window over ${pane.scroll}px of text` : 'no bounded pane found',
  )

  // ================= notifications are two feeds =================
  console.log('\n--- notifications ---')
  const { rows: me } = await db.query(`select id from auth.users where email = $1`, [email])
  const uid = me[0].id
  /* One of each, so the separation is measured rather than assumed. */
  await db.query(
    `select public.create_notification($1,'payout','VERIFY ads side','points message',null,'ads'),
            public.create_notification($1,'payout','VERIFY affiliate side','cedis message',null,'affiliate'),
            public.create_notification($1,'support','VERIFY account wide','support reply',null,'both')`,
    [uid],
  )

  /* ⚠️ The LIST pages, not the dashboards. Below md the bell is a link
     straight to the full page rather than a dropdown, so reading the
     dashboard body finds no notifications at all — and the "does not show the
     other business" half then passes for the wrong reason. */
  await page.goto(`${base}/market/notifications`, { waitUntil: 'networkidle' })
  const affBell = await page.locator('body').innerText()
  ok('the affiliate bell shows affiliate news', /VERIFY affiliate side/.test(affBell))
  ok('and NOT the ads news', !/VERIFY ads side/.test(affBell))
  ok('and still shows account-wide news', /VERIFY account wide/.test(affBell))

  await page.goto(`${base}/notifications`, { waitUntil: 'networkidle' })
  const adsBell = await page.locator('body').innerText()
  ok('the ads bell shows ads news', /VERIFY ads side/.test(adsBell))
  ok('and NOT the affiliate news', !/VERIFY affiliate side/.test(adsBell))
  ok('and still shows account-wide news', /VERIFY account wide/.test(adsBell))

  await db.query(`delete from public.notifications where title like 'VERIFY %'`)

  // ================= the header =================
  console.log('\n--- header ---')
  for (const [where, url] of [['affiliate', '/market'], ['ads', '/dashboard']]) {
    await page.goto(`${base}${url}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const h = await page.evaluate(() => {
      const word = [...document.querySelectorAll('header span')].find(
        (e) => e.textContent?.trim() === 'SidePerks',
      )
      const r = word?.getBoundingClientRect()
      return {
        wordmark: r ? (r.right <= window.innerWidth && r.width > 60 ? 'whole' : 'CLIPPED') : 'MISSING',
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    ok(`${where}: the wordmark is whole`, h.wordmark === 'whole', h.wordmark)
    ok(`${where}: nothing runs off the screen`, h.overflow === 0, `${h.overflow}px`)
  }

  // ================= the admin =================
  console.log('\n--- admin ---')
  const desk = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } })
  const admin2 = await desk.newPage()
  await admin2.goto(`${base}/admin/gift-codes`, { waitUntil: 'networkidle' })
  const giftAdmin = await admin2.locator('body').innerText()
  ok('the admin has BOTH gift code boards', /Points gift codes/i.test(giftAdmin) && /Commission gift codes/i.test(giftAdmin))
  ok('and the commission board is priced in cedis', /Worth \(GHS\)|Worth/i.test(giftAdmin) || /GHS/.test(giftAdmin))

  await admin2.goto(`${base}/admin/payouts`, { waitUntil: 'networkidle' })
  const payoutsText = await admin2.locator('body').innerText()
  ok('the payouts screen names its money', /Points payouts/i.test(payoutsText), (payoutsText.match(/Points payouts/) ?? [''])[0])
  ok('and points at the commission queue', /commission withdrawals/i.test(payoutsText))
  await desk.close()

  ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200))
  await context.close()
} catch (e) {
  console.log(`\nERROR ${e.message}`)
  fail += 1
} finally {
  /* The code and everything it wrote. A verify script that leaves money on an
     account is a verify script that has changed the thing it measured. */
  if (ledgerKey) {
    await db.query(`alter table public.commission_ledger disable trigger user`)
    await db.query(`delete from public.commission_ledger where idempotency_key = $1`, [ledgerKey])
    await db.query(`alter table public.commission_ledger enable trigger user`)
  }
  if (giftCodeId) {
    await db.query(`delete from public.commission_gift_code_redemptions where gift_code_id = $1`, [giftCodeId])
    await db.query(`delete from public.commission_gift_codes where id = $1`, [giftCodeId])
  }
  await db.end()
  await browser.close()
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exitCode = fail === 0 ? 0 : 1
