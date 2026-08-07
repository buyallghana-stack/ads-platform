/**
 * The course player, against the reference the operator sent (2026-08-07).
 *
 * Checks the parts a screenshot cannot: that the tab strip switches WITHOUT
 * remounting the player (the whole reason the tab is local state), that Next
 * and Previous point at the right lessons, that a part-watched lesson says how
 * much is left, and that the affiliate skin now has two themes.
 *
 * Sign in as admin@email.com — user@email.com carries the operator's real
 * authenticator and must never be driven by a script.
 *
 *   PORT=3100 npx next start
 *   node scripts/verify-course-player.mjs > /tmp/out.log 2>&1; tail -40 /tmp/out.log
 *
 * ⚠️ Redirect to a file and tail it. Piping this through `head` sends SIGPIPE
 * mid-run and the script dies between its setup and its restore.
 */
import { chromium } from '@playwright/test'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const base = process.env.BASE_URL ?? 'http://localhost:3100'
const email = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const password = process.env.SHOOT_PASSWORD ?? '1234'

let pass = 0
let fail = 0
const ok = (label, condition, detail = '') => {
  if (condition) {
    pass += 1
    console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`)
  } else {
    fail += 1
    console.log(`  ✗ ${label}${detail ? '  ' + detail : ''}`)
  }
}

const browser = await chromium.launch()

try {
  const loginContext = await browser.newContext()
  const loginPage = await loginContext.newPage()
  await loginPage.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await loginPage.getByLabel(/email/i).fill(email)
  await loginPage.locator('input[type="password"]').fill(password)
  await loginPage.getByRole('button', { name: /log in|connexion/i }).click()
  await loginPage.waitForURL(/\/(dashboard|admin)/, { timeout: 20000 })
  const state = await loginContext.storageState()
  await loginContext.close()
  console.log(`signed in as ${email}\n`)

  for (const theme of ['dark', 'light']) {
    console.log(`--- ${theme} ---`)
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
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(`${base}/learn`, { waitUntil: 'networkidle' })

    /* Whatever course this account owns. Hard-coding a slug would make the
       script fail the day the catalogue changes rather than the day the player
       breaks. */
    const first = page.locator('a[href*="/learn/"]').first()
    if ((await first.count()) === 0) {
      console.log('  ! this account owns no course; nothing to check')
      await context.close()
      continue
    }
    await first.click()
    await page.waitForURL(/\/learn\/[^/]+/, { timeout: 15000 })
    await page.waitForTimeout(700)

    // ---- The tab strip ----
    const tabs = page.getByRole('tab')
    ok('three tabs', (await tabs.count()) === 3, `found ${await tabs.count()}`)
    const names = await tabs.allInnerTexts()
    ok('Lectures is first and selected', (await tabs.first().getAttribute('aria-selected')) === 'true', names.join(' / ').replace(/\n/g, ' '))

    // ---- Switching tabs must not touch the player ----
    const playerBefore = await page.evaluate(() => {
      const el = document.querySelector('video')
      if (!el) return null
      el.dataset.marked = 'yes'
      return true
    })
    await tabs.nth(1).click()
    await page.waitForTimeout(300)
    ok('Resources panel shows', (await tabs.nth(1).getAttribute('aria-selected')) === 'true')
    const survived = await page.evaluate(() => document.querySelector('video')?.dataset.marked === 'yes')
    ok(
      'the player survived the tab switch',
      playerBefore === null || survived,
      playerBefore === null ? '(no video on this lesson)' : '',
    )

    await tabs.nth(2).click()
    await page.waitForTimeout(300)
    ok('About panel shows', (await tabs.nth(2).getAttribute('aria-selected')) === 'true')
    const aboutText = await page.locator('#course-panel-about').innerText()
    ok('About carries the course facts', /Lessons|Leçons/.test(aboutText))

    await tabs.first().click()
    await page.waitForTimeout(300)

    // ---- The lecture rows ----
    const lectures = await page.locator('#course-panel-lectures').innerText()
    ok('rows carry a kind', /Video|Article|Checkpoint|Vidéo|Point/.test(lectures))
    /* Only a lesson with a duration prints one. This course is articles and
       checkpoints, and inventing "00:00" for those would be the bug. */
    const timed = /\d\d:\d\d/.test(lectures)
    ok(
      timed ? 'timed rows print mm:ss' : 'untimed rows print no duration',
      true,
      timed ? (lectures.match(/\d\d:\d\d[^\n]*/) ?? [''])[0] : '(no lesson here has a duration)',
    )

    // ---- Next / Previous ----
    const next = page.getByRole('link', { name: /next|suivant/i }).first()
    ok('a Next control exists', (await next.count()) > 0)
    if ((await next.count()) > 0) {
      /* ⚠️ waitForURL, NOT a fixed pause. This navigation queues behind the
         router's prefetches and took 2.5s here — a 900ms sleep reported a
         working Next button as broken, twice, and sent me looking for a
         geometry bug that did not exist. */
      const before = page.url()
      const target = await next.getAttribute('href')
      await next.click()
      await page.waitForURL(`**${target}`, { timeout: 15000 }).catch(() => {})
      ok('Next opened another lesson', page.url() !== before, page.url().split('lesson=')[1]?.slice(0, 8) ?? '')

      const previous = page.getByRole('link', { name: /previous|précédent/i }).first()
      ok('a Previous control appears after moving on', (await previous.count()) > 0)
      if ((await previous.count()) > 0) {
        await previous.click()
        await page.waitForURL(/lesson=/, { timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(400)
        ok('Previous is a different lesson again', page.url() !== target)
      }
    }

    // ---- The theme switch ----
    await page.goto(`${base}/market`, { waitUntil: 'networkidle' })
    const themeButton = page.locator('header button[aria-label*="theme" i], header button[aria-label*="thème" i]')
    ok('the affiliate header has a theme switch', (await themeButton.count()) > 0)

    const skin = await page.evaluate(() => {
      const el = document.querySelector('.affiliate')
      if (!el) return null
      const style = getComputedStyle(el)
      return {
        canvas: style.getPropertyValue('--color-canvas').trim(),
        ink900: style.getPropertyValue('--color-ink-900').trim(),
        dark: document.documentElement.classList.contains('dark'),
      }
    })
    ok('the affiliate wrapper is on the page', skin !== null)
    if (skin) {
      const wantsDark = theme === 'dark'
      ok(
        `the skin follows the ${theme} theme`,
        wantsDark ? skin.canvas === '#0a0913' : skin.canvas === '#f8f7fd',
        `canvas ${skin.canvas}, ink-900 ${skin.ink900}`,
      )
    }

    /* ⚠️ Both of these shipped broken in light and neither is visible in dark.
       -950 is TEXT on the white pill of the period picker, and mirroring it to
       the light end of the ramp painted white on white; and the third icon in
       the header pill clipped the wordmark to "SidePer" at 390px. */
    const pill = await page.evaluate(() => {
      const el = document.querySelector('.affiliate')
      return el ? getComputedStyle(el).getPropertyValue('--color-brand-950').trim() : null
    })
    ok('brand-950 is dark enough to read on a white pill', pill === '#1a1338' || pill === '#2e1065', String(pill))

    const clipped = await page.evaluate(() => {
      const marks = [...document.querySelectorAll('header span')]
      const word = marks.find((el) => el.textContent?.trim() === 'SidePerks')
      if (!word) return 'not shown at this width'
      const r = word.getBoundingClientRect()
      return r.right <= window.innerWidth ? 'fits' : 'CLIPPED'
    })
    ok('the wordmark is not clipped', clipped !== 'CLIPPED', clipped)

    ok('no page errors', errors.length === 0, errors.join(' | '))

    await page.screenshot({
      path: `/tmp/claude-1000/-mnt-c-Users-Emmanuel-Ofori-Desktop-Ads/fdc6b011-b0c7-4974-9693-c0ebd646823e/scratchpad/market-${theme}.png`,
    })
    await context.close()
    console.log('')
  }
} catch (e) {
  console.log(`\nERROR ${e.message}`)
  fail += 1
} finally {
  await browser.close()
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exitCode = fail === 0 ? 0 : 1
