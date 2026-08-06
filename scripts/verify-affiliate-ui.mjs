/**
 * Every affiliate screen, at every breakpoint, checked for the two faults that
 * are invisible in code and obvious in a browser:
 *
 *   1. HORIZONTAL OVERFLOW. The body must never scroll sideways. A single flex
 *      item that refuses to shrink pushes the document wider than the viewport,
 *      and because a background paints its own box and not the document's, the
 *      symptom is the page's colour stopping halfway across rather than a
 *      scrollbar. That happened once on the curriculum list and was found here.
 *
 *   2. DEAD VERTICAL SCROLL. Content that occupies layout while rendering
 *      nothing. `sr-only` on a <table> does exactly this — the utility is
 *      `position:absolute; height:1px; overflow:hidden`, and a table lays
 *      itself out past that box. It cost /market 768px of empty scroll and had
 *      already shipped on the ads chart.
 *
 * Neither is catchable by reading the source, and neither shows up in a
 * screenshot of the top of the page.
 *
 *   node scripts/verify-affiliate-ui.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.BASE_URL ?? 'http://localhost:3111'
const email = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const password = process.env.SHOOT_PASSWORD ?? '1234'

const ROUTES = [
  '/market',
  '/market/account',
  '/shop',
  '/shop/affiliate-training-beginner',
  '/learn',
  '/learn/affiliate-training-professional',
  '/commission',
  '/p/affiliate-training-beginner',
]

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORTS[0] })
const page = await ctx.newPage()

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.getByLabel(/email/i).fill(email)
await page.locator('input[type="password"]').fill(password)
await page.getByRole('button', { name: /log in|connexion/i }).click()
await page.waitForURL(/\/(dashboard|admin)(\/|$|\?)/, { timeout: 15000 })

let failures = 0

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const response = await page.goto(`${base}/en${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)

    const report = await page.evaluate(() => {
      const doc = document.documentElement

      /* Anything sticking out past the right edge, ignoring what is
         deliberately positioned off-screen to the left (sr-only, drawers). */
      const wide = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > doc.clientWidth + 1) {
          wide.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 60),
            right: Math.round(r.right),
          })
        }
      }

      /* Where the last VISIBLE thing ends, versus how far the page scrolls. */
      let lowest = 0
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        if (r.width === 0 || r.height === 0) continue
        if (style.visibility === 'hidden' || style.opacity === '0') continue
        if (style.position === 'fixed') continue
        lowest = Math.max(lowest, r.bottom + window.scrollY)
      }

      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        scrollHeight: doc.scrollHeight,
        contentEnds: Math.round(lowest),
        wide: wide.slice(0, 4),
      }
    })

    const label = `${route} @ ${viewport.name}`
    const problems = []

    if (response?.status() !== 200) problems.push(`HTTP ${response?.status()}`)
    if (report.scrollWidth > report.clientWidth + 1) {
      problems.push(
        `scrolls sideways (${report.scrollWidth} > ${report.clientWidth}) — ${report.wide
          .map((w) => `${w.tag}.${w.cls}`)
          .join(' | ')}`,
      )
    }
    /* 120px of slack: a fixed tab bar and the page's bottom padding legitimately
       sit below the last laid-out element. */
    if (report.scrollHeight - report.contentEnds > 120) {
      problems.push(`${report.scrollHeight - report.contentEnds}px of dead scroll`)
    }

    if (problems.length) {
      failures += 1
      console.log(`✗ ${label}\n    ${problems.join('\n    ')}`)
    } else {
      console.log(`✓ ${label}`)
    }
  }
}

await browser.close()

if (failures) {
  console.error(`\n${failures} problem(s).`)
  process.exitCode = 1
} else {
  console.log('\nEvery affiliate screen fits its viewport and scrolls no further than its content.')
}
