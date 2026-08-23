/**
 * Capture genuine app screens for marketing across Mobile and Desktop device frames.
 *
 * Runs against the seeded demo account (Jones):
 *   node --env-file=.env.local scripts/seed-marketing-demo.mjs
 *   PORT=3100 npm start &
 *   node scripts/shoot-marketing.mjs
 */
import { mkdir, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const base = process.env.BASE_URL ?? 'http://localhost:3100'
const email = process.env.SHOOT_EMAIL ?? 'jones@demo.invalid'
const password = process.env.SHOOT_PASSWORD ?? 'Marketing!2026'

const outDir = path.resolve('public/marketing')
const rawDir = path.resolve('.screenshots/marketing-raw')

const MOBILE_SHOTS = [
  { slug: 'ads-feed', route: '/ads', clipHeight: 740 },
  { slug: 'home', route: '/dashboard', clipHeight: 740 },
  { slug: 'withdraw', route: '/withdraw', clipHeight: 740 },
]

const DESKTOP_SHOTS = [
  { slug: 'desktop-ads', route: '/ads', clipHeight: 700 },
  { slug: 'desktop-home', route: '/dashboard', clipHeight: 700 },
  { slug: 'desktop-withdraw', route: '/withdraw', clipHeight: 700 },
]

await mkdir(outDir, { recursive: true })
await rm(rawDir, { recursive: true, force: true })
await mkdir(rawDir, { recursive: true })

const browser = await chromium.launch()

// ---- Sign in as Jones ---------------------------------
const loginContext = await browser.newContext()
const loginPage = await loginContext.newPage()
await loginPage.goto(`${base}/login`, { waitUntil: 'networkidle' })
await loginPage.getByLabel(/email/i).fill(email)
await loginPage.locator('input[type="password"]').fill(password)
await loginPage.getByRole('button', { name: /log in|connexion/i }).click()
await loginPage.waitForURL(/\/(dashboard|ads|withdraw)/, { timeout: 20000 })
const state = await loginContext.storageState()
await loginContext.close()
console.log(`Signed in as ${email} (Jones)`)

// 1. Mobile Shots (iPhone / Android)
for (const theme of ['light', 'dark']) {
  for (const shot of MOBILE_SHOTS) {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce',
      colorScheme: theme,
    })
    const page = await context.newPage()
    await page.goto(base + shot.route, { waitUntil: 'networkidle' })
    if (theme === 'dark') {
      await page.evaluate(() => {
        document.documentElement.classList.add('dark')
      })
    }
    await page.waitForTimeout(1000)

    const name = `${shot.slug}-${theme}`
    const raw = path.join(rawDir, `${name}.png`)
    await page.screenshot({
      path: raw,
      clip: { x: 0, y: 0, width: 390, height: shot.clipHeight },
    })

    await sharp(raw)
      .webp({ quality: 84 })
      .toFile(path.join(outDir, `${name}.webp`))

    console.log(`[Mobile]  ${theme.padEnd(5)} ${shot.route.padEnd(12)} -> ${name}.webp`)
    await context.close()
  }
}

// 2. Desktop Shots (Safari / Laptop)
for (const theme of ['light', 'dark']) {
  for (const shot of DESKTOP_SHOTS) {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: 1200, height: 750 },
      deviceScaleFactor: 2,
      hasTouch: false,
      isMobile: false,
      reducedMotion: 'reduce',
      colorScheme: theme,
    })
    const page = await context.newPage()
    await page.goto(base + shot.route, { waitUntil: 'networkidle' })
    if (theme === 'dark') {
      await page.evaluate(() => {
        document.documentElement.classList.add('dark')
      })
    }
    await page.waitForTimeout(1000)

    const name = `${shot.slug}-${theme}`
    const raw = path.join(rawDir, `${name}.png`)
    await page.screenshot({
      path: raw,
      clip: { x: 0, y: 0, width: 1200, height: shot.clipHeight },
    })

    await sharp(raw)
      .webp({ quality: 84 })
      .toFile(path.join(outDir, `${name}.webp`))

    console.log(`[Desktop] ${theme.padEnd(5)} ${shot.route.padEnd(12)} -> ${name}.webp`)
    await context.close()
  }
}

await browser.close()

const written = await readdir(outDir)
console.log(`\nUpdated images in ${outDir}:`)
for (const f of written.sort()) console.log(' ', f)
