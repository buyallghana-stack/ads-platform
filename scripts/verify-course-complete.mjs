/**
 * Finishing a course: the congratulation screen and the certificate button.
 *
 * Operator, 2026-08-08: "when a user successfully complete a course show him a
 * congratulation screen and a button for him to download his certificate".
 *
 * PRECONDITION: the account must already hold a FINISHED course with a
 * certificate. `admin@email.com` finished Affiliate Training: Professional.
 *
 * The interesting assertions are the ones about state rather than pixels: the
 * screen is shown ONCE, the panel it leaves behind is permanent, and the button
 * actually lands on a certificate page rather than a 404.
 *
 *   node scripts/verify-course-complete.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.SHOOT_BASE ?? 'http://localhost:3100/en'
const email = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const password = process.env.SHOOT_PASSWORD ?? '1234'
const course = process.env.SHOOT_COURSE ?? 'affiliate-training-professional'

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
/* A FRESH context every run: the celebration is remembered in localStorage, so
   reusing a profile would test nothing after the first time. */
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.getByLabel(/email/i).fill(email)
await page.locator('input[type="password"]').fill(password)
await page.getByRole('button', { name: /log in|connexion/i }).click()
await page.waitForURL(/\/(dashboard|admin)/, { timeout: 20000 })

// ── the moment ────────────────────────────────────────────────────────────
await page.goto(`${base}/learn/${course}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const dialog = page.getByRole('dialog')
check('the congratulation screen appears on a finished course', (await dialog.count()) === 1)

const text = await dialog.innerText().catch(() => '')
check('it congratulates by name', /congratulations/i.test(text) && /affiliate training/i.test(text))
check('it states the lessons finished', /\bLESSONS\b/i.test(text))

const download = dialog.getByRole('link', { name: /download your certificate/i })
check('it carries a download button', (await download.count()) === 1)

// ── the button reaches a real certificate ─────────────────────────────────
await download.click()
let landed = false
try {
  await page.waitForURL(/\/market\/certificate\/[0-9a-f-]{36}/, { timeout: 15000 })
  landed = true
} catch {
  /* reported below */
}
check('the button lands on the certificate page', landed, page.url())
check(
  'the certificate page is not a 404',
  /your certificate/i.test(await page.locator('body').innerText()),
)

// ── it is a moment, not a nag ─────────────────────────────────────────────
await page.goto(`${base}/learn/${course}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
check('it does not appear a second time', (await page.getByRole('dialog').count()) === 0)

const body = await page.locator('body').innerText()
check('the completion panel stays behind', /course complete/i.test(body))
check(
  'and keeps the way to the certificate',
  (await page.getByRole('link', { name: /download your certificate/i }).count()) === 1,
)

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
