/**
 * Can you actually get from one business to the other, at every width?
 *
 * ⚠️ THIS ASSERTS ON *VISIBLE* LINKS, WHICH IS THE ENTIRE POINT.
 *
 * The first mode switch shipped rendered only inside the sidebar, which is
 * `md:flex`. On a phone there was no route into the second business at all —
 * and the bug was invisible in the source, because the component was plainly
 * imported and plainly used. It was also invisible to a naive browser check,
 * because `locator(...).first()` happily matches the hidden desktop copy and
 * reports success.
 *
 * So: count links to the destination that are actually VISIBLE, at each width.
 *
 *   node scripts/verify-mode-switch.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.BASE_URL ?? 'http://localhost:3111'
const email = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const password = process.env.SHOOT_PASSWORD ?? '1234'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
]

/* From an ads screen you must be able to reach /market; from an affiliate
   screen you must be able to reach /dashboard. */
const CASES = [
  { from: '/dashboard', to: '/market' },
  { from: '/market', to: '/dashboard' },
  { from: '/shop', to: '/dashboard' },
  { from: '/commission', to: '/dashboard' },
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

for (const { from, to } of CASES) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto(`${base}/en${from}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)

    /* `:visible` rather than .first(): a hidden copy must not count.

       The href is UNPREFIXED — next-intl omits the prefix for the default
       locale — so matching on `/en${to}` found nothing and reported every
       route as broken, including the ones that plainly worked. A verification
       script that fails open is bad; one that fails closed on its own selector
       wastes an afternoon. */
    const links = page.locator(`a[href="${to}"]:visible`)
    const count = await links.count()
    const label = `${from} → ${to} @ ${viewport.name}`

    if (count === 0) {
      failures += 1
      console.log(`✗ ${label} — no visible link`)
      continue
    }

    /* And it has to actually go there when tapped, at a real coordinate — a
       link under an overlay is a link that does nothing. */
    await links.first().click()
    await page.waitForURL(new RegExp(`(/en)?${to}(\\?|$|/)`), { timeout: 10000 }).catch(() => {})
    const landed = new URL(page.url()).pathname.replace(/^\/en/, "") === to

    if (!landed) {
      failures += 1
      console.log(`✗ ${label} — visible (${count}) but the tap landed on ${page.url()}`)
    } else {
      console.log(`✓ ${label} (${count} visible)`)
    }
  }
}

await browser.close()

if (failures) {
  console.error(`\n${failures} problem(s) — one of the businesses is unreachable somewhere.`)
  process.exitCode = 1
} else {
  console.log('\nBoth businesses are reachable from the other at every width.')
}
