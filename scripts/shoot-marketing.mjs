/**
 * Capture the REAL app screens used as imagery on the marketing landing page.
 *
 * The landing page shows the product, not a drawing of the product — so these
 * are genuine signed-in screens, taken at phone width in both themes and
 * written into `public/marketing/` as WebP.
 *
 * Both themes are captured because the landing page follows the visitor's
 * theme; a light screenshot pasted onto the dark page reads as a foreign
 * object. The page swaps them with `dark:` visibility utilities.
 *
 *   PORT=3100 pnpm start
 *   node scripts/shoot-marketing.mjs
 *
 * Sign in as admin@email.com — user@email.com carries the operator's real
 * authenticator and must never be driven by a script.
 */
import { mkdir, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const base = process.env.BASE_URL ?? 'http://localhost:3100'
const email = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const password = process.env.SHOOT_PASSWORD ?? '1234'

const outDir = path.resolve('public/marketing')
const rawDir = path.resolve('.screenshots/marketing-raw')

/**
 * Each shot is a phone-width viewport. `clipHeight` trims the capture to the
 * part that reads well inside a device frame — a full 844px screen shrunk to
 * fit a landing-page column loses every number on it.
 */
const ALL_SHOTS = [
  { slug: 'ads-feed', route: '/ads', clipHeight: 720 },
  { slug: 'home', route: '/dashboard', clipHeight: 720 },
  { slug: 'withdraw', route: '/withdraw', clipHeight: 720 },
]

/**
 * `ONLY=home,withdraw` re-shoots a subset. The shots do not all come from the
 * same account — the feed needs a fresh account (the demo admin has completed
 * every ad) while the balance hero needs one with history — so re-running the
 * whole set under one login would overwrite good frames with empty ones.
 */
const only = process.env.ONLY?.split(',').map((s) => s.trim()).filter(Boolean)
const SHOTS = only ? ALL_SHOTS.filter((s) => only.includes(s.slug)) : ALL_SHOTS
if (!SHOTS.length) throw new Error(`ONLY matched no shots: ${process.env.ONLY}`)

const WIDTH = 390
const SCALE = 2

await mkdir(outDir, { recursive: true })
await rm(rawDir, { recursive: true, force: true })
await mkdir(rawDir, { recursive: true })

const browser = await chromium.launch()

// ---- Sign in once, reuse the cookies. ---------------------------------
const loginContext = await browser.newContext()
const loginPage = await loginContext.newPage()
await loginPage.goto(`${base}/login`, { waitUntil: 'networkidle' })
await loginPage.getByLabel(/email/i).fill(email)
await loginPage.locator('input[type="password"]').fill(password)
await loginPage.getByRole('button', { name: /log in|connexion/i }).click()
await loginPage.waitForURL(/\/(dashboard|admin)/, { timeout: 20000 })
const state = await loginContext.storageState()
await loginContext.close()
console.log(`signed in as ${email}`)

for (const theme of ['light', 'dark']) {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: WIDTH, height: 844 },
      deviceScaleFactor: SCALE,
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce',
      colorScheme: theme,
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    const res = await page.goto(base + shot.route, { waitUntil: 'networkidle' })
    if (theme === 'dark') {
      await page
        .waitForFunction(() => document.documentElement.classList.contains('dark'), {
          timeout: 5000,
        })
        .catch(() => {})
    }
    // The entry animation is staggered; reduced-motion flattens it, but give
    // images and the chart a beat to settle before the shutter.
    await page.waitForTimeout(900)

    const raw = path.join(rawDir, `${shot.slug}-${theme}.png`)
    await page.screenshot({
      path: raw,
      clip: { x: 0, y: 0, width: WIDTH, height: shot.clipHeight },
    })

    await sharp(raw)
      .webp({ quality: 82 })
      .toFile(path.join(outDir, `${shot.slug}-${theme}.webp`))

    console.log(
      `${theme.padEnd(5)} ${shot.route.padEnd(12)} HTTP ${res?.status()}  ${
        errors.length ? '⚠ ' + errors.join(' | ') : 'clean'
      }`,
    )
    await context.close()
  }
}

await browser.close()

const written = await readdir(outDir)
console.log(`\n${outDir}:`)
for (const f of written.sort()) console.log(' ', f)
