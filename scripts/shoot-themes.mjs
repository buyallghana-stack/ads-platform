/**
 * Capture a route in BOTH themes at the three breakpoints.
 * Dark is driven via emulated `prefers-color-scheme: dark`, which next-themes
 * (defaultTheme="system") turns into a `dark` class on <html> — exactly the
 * path a real visitor on a dark-set OS takes.
 *
 *   node shoot-themes.mjs /signup
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

const route = process.argv[2] ?? '/'
const base = process.env.BASE_URL ?? 'http://localhost:3000'
const outDir = path.resolve(process.env.OUT_DIR ?? '.screenshots')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const slug = route.replace(/^\//, '').replace(/\//g, '-') || 'home'

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
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
    // Confirm next-themes resolved the scheme onto <html> before shooting.
    if (theme === 'dark') {
      await page.waitForFunction(() => document.documentElement.classList.contains('dark'), { timeout: 4000 }).catch(() => {})
    }
    await page.waitForTimeout(350)
    const file = path.join(outDir, `${slug}-${theme}-${vp.name}.png`)
    await page.screenshot({ path: file })
    console.log(`${theme.padEnd(5)} ${vp.name.padEnd(8)} HTTP ${res?.status()}  ${errors.length ? '⚠ ' + errors.length : 'clean'}`)
    for (const e of errors.slice(0, 2)) console.log('        ' + e.slice(0, 140))
    await context.close()
  }
}
await browser.close()
