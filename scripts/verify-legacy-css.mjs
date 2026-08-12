/**
 * The Ads tab on a browser without `@property`.
 *
 * Operator, 2026-08-12: the Ads tab "is still distorted" on an iPhone 7 after
 * the covers were fixed. Home was fine, which is the clue: that phone runs
 * Safari 15.6, `@property` arrived in 16.4, and Tailwind v4 keeps its internals
 * in registered variables. `.border` is
 *
 *     border-style: var(--tw-border-style); border-width: 1px
 *
 * so on that phone the first half is invalid, the second does nothing on its
 * own (the default style is `none`), and every card outline disappears. Home is
 * a filled panel and shows no damage; the Ads tab is white cards on a white
 * page and becomes one slab.
 *
 * ── HOW THIS TESTS A PHONE NOBODY HAS ──
 *
 * Chromium supports `@property`, so the browser is made to forget it: every
 * stylesheet is intercepted on the way in and its `@property` blocks are
 * deleted. What is left is exactly what Safari 15.6 keeps. The run then asserts
 * the borders are still painted, which they only are because `globals.css`
 * restates the initial values as plain declarations.
 *
 *   node --env-file=.env.local scripts/verify-legacy-css.mjs
 *
 * Needs a server on BASE — `npm run build && npx next start -p 3100`.
 * Screenshots land in the scratch directory named by SHOTS (optional).
 */
import { chromium } from '@playwright/test'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const BASE = process.env.BASE ?? 'http://localhost:3100'
const EMAIL = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const PASSWORD = process.env.SHOOT_PASSWORD ?? '1234'
const SHOTS = process.env.SHOTS ?? ''

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

let browser = null

try {
  browser = await chromium.launch()
  /* An iPhone 7 viewport: 375x667 at 2x. The size was never the problem — the
     app is fine at 375 on a modern browser — but rendering at the real size
     keeps the screenshots comparable with what the operator sees. */
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })

  /* ⚠️ THE WHOLE TRICK. Strip every `@property` block out of every stylesheet
     before the browser parses it, which leaves Chromium in the state Safari
     15.6 is in permanently. Done at the network layer rather than by injecting
     CSS, because a registered property cannot be un-registered from script. */
  let stripped = 0
  await ctx.route('**/*.css', async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    const withoutProperty = body.replace(/@property\s+--[\w-]+\s*\{[^}]*\}/g, '')
    stripped += (body.match(/@property/g) ?? []).length
    await route.fulfill({ response, body: withoutProperty })
  })

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })

  await page.goto(`${BASE}/ads`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  check('the stylesheet really lost its @property blocks', stripped > 0, `${stripped} removed`)

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/legacy-ads.png`, fullPage: false })

  /* ---- the borders, which is the fault the operator reported ----------- */
  const card = page.locator('article, [data-ad-card]').first()
  const cards = await page.locator('article, [data-ad-card]').count()
  check('the ads tab rendered some cards', cards > 0, `${cards} cards`)

  if (cards > 0) {
    const border = await card.evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        style: s.borderTopStyle,
        width: s.borderTopWidth,
        colour: s.borderTopColor,
      }
    })
    check(
      'a card still has a painted border without @property',
      border.style === 'solid' && parseFloat(border.width) > 0,
      `${border.style} ${border.width} ${border.colour}`,
    )
  }

  /* ---- centring, the other half of the distortion ---------------------- */
  const disc = page.locator('.-translate-x-1\\/2, .-translate-y-1\\/2').first()
  if ((await disc.count()) > 0) {
    const translate = await disc.evaluate((el) => getComputedStyle(el).translate)
    check(
      'a centred overlay still resolves its translate',
      translate !== '' && translate !== 'none',
      String(translate),
    )
  }

  /* ---- and nothing sits on top of anything else ------------------------ */
  if (cards > 0) {
    const overlap = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('article, [data-ad-card]')].map((el) =>
        el.getBoundingClientRect(),
      )
      let worst = 0
      for (let i = 1; i < boxes.length; i += 1) {
        worst = Math.max(worst, boxes[i - 1].bottom - boxes[i].top)
      }
      return Math.round(worst)
    })
    check('no card overlaps the one below it', overlap <= 0, `${overlap}px of overlap`)
  }

  check('no page errors', errors.length === 0, errors.join(' | '))
} catch (error) {
  check('the run completed', false, error.message)
} finally {
  if (browser) await browser.close()
  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length}`)
  if (passed !== results.length) process.exitCode = 1
}
