/**
 * Screenshot a signed-in app route in both themes at the three breakpoints.
 * Logs in once as the seeded demo user and reuses the session cookies.
 *
 *   node scripts/shoot-app.mjs /dashboard
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, scale: 2, touch: true },
  { name: 'tablet', width: 834, height: 1112, scale: 2, touch: true },
  { name: 'desktop', width: 1440, height: 900, scale: 1, touch: false },
]
const THEMES = ['light', 'dark']

const route = process.argv[2] ?? '/dashboard'
const fullPage = process.argv.includes('--full')
const base = process.env.BASE_URL ?? 'http://localhost:3000'
const outDir = path.resolve(process.env.OUT_DIR ?? '.screenshots')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()

// ---- Log in once, keep the cookies. -----------------------------------
const loginContext = await browser.newContext()
const loginPage = await loginContext.newPage()
await loginPage.goto(`${base}/login`, { waitUntil: 'networkidle' })
await loginPage.getByLabel(/email/i).fill('user@email.com')
await loginPage.locator('input[type="password"]').fill('1234')
await loginPage.getByRole('button', { name: /log in|connexion/i }).click()
await loginPage.waitForURL('**/dashboard', { timeout: 15000 })
const state = await loginContext.storageState()
await loginContext.close()
console.log('logged in as user@email.com')

const slug = route.replace(/^\//, '').replace(/\//g, '-') || 'home'

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.scale,
      hasTouch: vp.touch,
      isMobile: vp.touch,
      reducedMotion: 'reduce',
      colorScheme: theme,
    })
    const page = await context.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    const res = await page.goto(base + route, { waitUntil: 'networkidle' })
    if (theme === 'dark') {
      await page
        .waitForFunction(() => document.documentElement.classList.contains('dark'), { timeout: 4000 })
        .catch(() => {})
    }
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(outDir, `${slug}-${theme}-${vp.name}.png`), fullPage })
    console.log(
      `${theme.padEnd(5)} ${vp.name.padEnd(8)} HTTP ${res?.status()}  ${errors.length ? '⚠ ' + errors.length : 'clean'}`,
    )
    for (const e of errors.slice(0, 2)) console.log('        ' + e.slice(0, 140))
    await context.close()
  }
}
await browser.close()
