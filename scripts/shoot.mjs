/**
 * Screenshot a route at the three breakpoints the layout targets.
 *
 *   pnpm shoot /signup            -> .screenshots/signup-{mobile,tablet,desktop}.png
 *   pnpm shoot /signup --full     -> full-page rather than viewport
 *
 * Exists so responsive behaviour is verified by looking at it rather than by
 * reasoning about class names.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { chromium } from '@playwright/test'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, scale: 2 }, // iPhone 14 class
  { name: 'tablet', width: 834, height: 1112, scale: 2 }, // iPad Air portrait
  { name: 'desktop', width: 1440, height: 900, scale: 1 },
]

const route = process.argv[2] ?? '/'
const fullPage = process.argv.includes('--full')
const base = process.env.BASE_URL ?? 'http://localhost:3000'
const outDir = path.resolve('.screenshots')

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const slug = route.replace(/^\//, '').replace(/\//g, '-') || 'home'
const failures = []

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.scale,
    // Reduced motion so the carousel does not land mid-transition and make
    // two runs of the same page look different.
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  const res = await page.goto(base + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300) // let fonts settle

  const file = path.join(outDir, `${slug}-${vp.name}.png`)
  await page.screenshot({ path: file, fullPage })

  const status = res?.status() ?? 0
  if (status >= 400) failures.push(`${vp.name}: HTTP ${status}`)
  if (consoleErrors.length) failures.push(`${vp.name}: ${consoleErrors.length} console error(s)`)

  console.log(
    `${vp.name.padEnd(8)} ${String(vp.width).padStart(4)}x${vp.height}  HTTP ${status}` +
      `  ${consoleErrors.length ? `⚠ ${consoleErrors.length} console error(s)` : 'clean'}`,
  )
  for (const e of consoleErrors.slice(0, 3)) console.log(`           ${e.slice(0, 150)}`)

  await context.close()
}

await browser.close()

if (failures.length) {
  console.log('\nissues:')
  for (const f of failures) console.log('  ' + f)
  process.exitCode = 1
}
