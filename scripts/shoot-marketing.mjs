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

    // Add mobile status-bar safe-area clearance and status bar chrome
    await page.evaluate(() => {
      const isDark = document.documentElement.classList.contains('dark')
      const textColor = isDark ? '#F8FAFC' : '#0F172A'

      // Push page header below the Dynamic Island / camera punch-hole
      const appContainer = document.querySelector('main') || document.body
      appContainer.style.paddingTop = '54px'

      // Render crisp iOS status bar
      const bar = document.createElement('div')
      bar.id = 'status-bar-overlay'
      bar.style.position = 'fixed'
      bar.style.top = '0'
      bar.style.left = '0'
      bar.style.right = '0'
      bar.style.height = '50px'
      bar.style.display = 'flex'
      bar.style.alignItems = 'center'
      bar.style.justifyContent = 'space-between'
      bar.style.padding = '0 24px 6px'
      bar.style.zIndex = '999999'
      bar.style.pointerEvents = 'none'
      bar.style.fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'

      bar.innerHTML = `
        <div style="font-weight: 600; font-size: 14px; letter-spacing: -0.2px; color: ${textColor}; padding-top: 10px;">9:41</div>
        <div style="display: flex; align-items: center; gap: 5px; color: ${textColor}; padding-top: 10px;">
          <svg width="17" height="11" viewBox="0 0 17 11" fill="${textColor}"><rect x="1" y="7.5" width="2.5" height="3" rx="0.5"/><rect x="5" y="5.5" width="2.5" height="5" rx="0.5"/><rect x="9" y="3" width="2.5" height="7.5" rx="0.5"/><rect x="13" y="0.5" width="2.5" height="10" rx="0.5"/></svg>
          <svg width="16" height="11" viewBox="0 0 16 11" fill="${textColor}"><path d="M8 2.5C5.8 2.5 3.8 3.4 2.3 4.9L1.2 3.8C3 2 5.4 1 8 1s5 1 6.8 2.8l-1.1 1.1C12.2 3.4 10.2 2.5 8 2.5zM8 6c-1.3 0-2.5.5-3.4 1.4L3.5 6.3C4.7 5.1 6.3 4.5 8 4.5s3.3.6 4.5 1.8l-1.1 1.1C10.5 6.5 9.3 6 8 6zm0 3.5c-.7 0-1.3.3-1.8.8l1.8 1.7 1.8-1.7c-.5-.5-1.1-.8-1.8-.8z"/></svg>
          <div style="width: 22px; height: 11px; border: 1.5px solid ${textColor}; border-radius: 3.5px; padding: 1.5px; display: flex; align-items: center; position: relative;">
            <div style="width: 100%; height: 100%; background: ${textColor}; border-radius: 1px;"></div>
            <div style="position: absolute; right: -3.5px; top: 2.5px; width: 1.5px; height: 4px; background: ${textColor}; border-radius: 0 1px 1px 0;"></div>
          </div>
        </div>
      `
      document.body.appendChild(bar)
    })

    await page.waitForTimeout(1000)

    const name = `${shot.slug}-${theme}`
    const raw = path.join(rawDir, `${name}.png`)
    await page.screenshot({
      path: raw,
      clip: { x: 0, y: 0, width: 390, height: 844 },
    })

    await sharp(raw)
      .webp({ quality: 86 })
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
      clip: { x: 0, y: 0, width: 1200, height: 750 },
    })

    await sharp(raw)
      .webp({ quality: 86 })
      .toFile(path.join(outDir, `${name}.webp`))

    console.log(`[Desktop] ${theme.padEnd(5)} ${shot.route.padEnd(12)} -> ${name}.webp`)
    await context.close()
  }
}

await browser.close()

const written = await readdir(outDir)
console.log(`\nUpdated images in ${outDir}:`)
for (const f of written.sort()) console.log(' ', f)
