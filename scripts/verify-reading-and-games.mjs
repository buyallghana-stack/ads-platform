/**
 * Two operator reports, checked against the running app (2026-08-08).
 *
 *   1. An article never completed however much of it was read. Two stricter
 *      rules were tried and dropped; opening one now marks it read, and Next
 *      is never waiting on an article.
 *   2. A free account was promised on the games hub that new plays arrive every
 *      Monday. The Free tier grants zero, so no play ever arrives.
 *
 * Both need the real screens: the first is an effect in the browser, the second
 * depends on the signed-in account's tier.
 *
 * PRECONDITION for the article half: the account must have at least one
 * UNFINISHED article in the course. Each run finishes one, so a course that has
 * reached 100% will fail the "exactly ONE lesson completed" check with nothing
 * left to complete. Clear a lesson_progress row to run it again.
 *
 *   node scripts/verify-reading-and-games.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.SHOOT_BASE ?? 'http://localhost:3100/en'
const email = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const password = process.env.SHOOT_PASSWORD ?? '1234'

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

// ── sign in ────────────────────────────────────────────────────────────────
await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.getByLabel(/email/i).fill(email)
await page.locator('input[type="password"]').fill(password)
await page.getByRole('button', { name: /log in|connexion/i }).click()
await page.waitForURL(/\/(dashboard|admin)/, { timeout: 20000 })

// ── 1. the games hub, on an account whose plan grants nothing ─────────────
await page.goto(`${base}/games`, { waitUntil: 'networkidle' })
const gamesText = await page.locator('body').innerText()

/* The renewal must not be PROMISED. Saying "no new plays arrive on Monday" is
   the fix, not the bug, so the negated form has to survive this — an earlier
   version of this check failed on the very sentence it was written to demand. */
check(
  'games: no Monday renewal is promised',
  !/new plays on \w/i.test(gamesText) && !/(?<!no )new plays arrive on monday/i.test(gamesText),
  gamesText.match(/New plays (?:on|arrive)[^\n]*/i)?.[0] ?? '',
)
check('games: the zero allowance is stated', /gives you 0 game plays/i.test(gamesText))
check(
  'games: an upgrade link is offered',
  (await page.getByRole('link', { name: /upgrade to play/i }).count()) === 1,
)
const upgradeHref = await page
  .getByRole('link', { name: /upgrade to play/i })
  .first()
  .getAttribute('href')
check('games: it points at the upgrade screen', /\/upgrade$/.test(upgradeHref ?? ''), upgradeHref ?? '')
check(
  'games: neither board is openable from the hub',
  (await page.locator('a[href*="/games/mystery-box"], a[href*="/games/wheel"]').count()) === 0,
)

// A board reached by typing the URL refuses too.
await page.goto(`${base}/games/wheel`, { waitUntil: 'networkidle' })
check('games: a board typed by URL bounces to the hub', /\/games$/.test(page.url()), page.url())

// ── 2. OPENING an article marks it read, and marks NOTHING ELSE ──────────
//
// The second half of this is the regression that matters. Auto-marking on
// arrival, combined with the course page opening "the first unfinished
// lesson", walked the whole course: mark, revalidate, land on the next
// unfinished article, mark, revalidate... one visit finished every article and
// issued a certificate. So the count is read before and after, and it has to
// move by exactly one.
const doneCount = async () =>
  Number((await page.locator('body').innerText()).match(/(\d+) of \d+ done/)?.[1] ?? -1)

await page.goto(`${base}/learn/affiliate-training-professional`, { waitUntil: 'networkidle' })

/* Landing with no `?lesson=` is the exact path that cascaded, so that is the
   path this drives. The page should pin the lesson it chose into the URL. */
check('article: the open lesson is pinned in the URL', /\?lesson=[0-9a-f-]{36}$/.test(page.url()), page.url())
const pinned = page.url()
const before = await doneCount()

/* NOTHING is touched from here. No scrolling, no waiting out a timer, no
   clicking Next — if any of those were still required this would fail. */
const scrollTop = await page
  .locator('[class*="overflow-y-auto"]')
  .last()
  .evaluate((el) => el.scrollTop)
check('article: the reader has not scrolled a pixel', scrollTop === 0, `scrollTop ${scrollTop}`)

await page.waitForTimeout(2000) // the server action's round trip, not a dwell
check('article: simply opening it marks it read', /marked as read/i.test(await page.locator('body').innerText()))
check(
  'article: no instruction to scroll or wait survives',
  !/scroll to the end|keep reading/i.test(await page.locator('body').innerText()),
)

/* Long enough for a cascade to have walked several lessons if one existed. */
await page.waitForTimeout(6000)
check('article: the page has not moved itself to another lesson', page.url() === pinned, page.url())

await page.reload({ waitUntil: 'networkidle' })
const after = await doneCount()
check('article: it is still read after a reload, so the server took it', after > before)
check(
  'article: exactly ONE lesson completed, not a cascade',
  after === before + 1,
  `${before} -> ${after}`,
)

const nextButton = page.getByRole('button', { name: /next/i }).or(page.getByRole('link', { name: /^next/i }))
if (await nextButton.count()) {
  check('article: Next is usable straight away', !(await nextButton.first().isDisabled().catch(() => false)))
}

await page.screenshot({ path: 'scripts/out/article-on-open.png', fullPage: false })
await page.goto(`${base}/games`, { waitUntil: 'networkidle' })
await page.screenshot({ path: 'scripts/out/games-locked.png', fullPage: false })

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
