/**
 * Choosing what to pay for a plan: the slider, the −/+ pair, and the notice
 * that fires when somebody buys without ever choosing.
 *
 * WHY THE BUTTONS EXIST AND ARE TESTED SEPARATELY. The amount is the price of
 * the product now, so the control that sets it cannot have only one way in — a
 * range input is awkward with a thumb, harder with a tremor, and unusable on
 * some assistive setups. If the buttons ever stop moving the preview, a whole
 * group of people can only ever buy at the floor price.
 *
 * AND WHY THE NOTICE EXISTS. The floor is pre-selected, so a price that was
 * already sitting there does not read as a choice. Somebody who taps "Get
 * Bronze" without touching anything is told once that the price is theirs to
 * set — and never again if they say so.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? ''

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const stamp = Date.now()
const EMAIL = `picker-${stamp}@test.invalid`
const PASSWORD = `Picker!${stamp}`
let userId = null
let browser = null

await db.connect()

/** The Bronze card, which is the first one with a range. */
const bronze = (page) => page.locator('article, div').filter({ hasText: /^Bronze/ }).first()

/** What the card currently promises, read off the preview. */
const preview = async (page) => {
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const window = text.slice(text.indexOf('Bronze'), text.indexOf('Silver'))
  return {
    chosen: window.match(/Choose your amount GHS ([\d,]+)/)?.[1] ?? null,
    /* No space before "pts": the unit is spaced by a CSS margin rather than
       by a space character, so innerText runs them together as "150pts". */
    points: window.match(/PER AD ([\d,]+)\s*pts/)?.[1] ?? null,
    perDay: window.match(/PER DAY GHS ([\d.,]+)/)?.[1] ?? null,
    heading: window.match(/Bronze GHS ([\d,]+ – [\d,]+)/)?.[1] ?? null,
  }
}

try {
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Picker Tester' },
  })
  if (error) throw error
  userId = data.user.id

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  await page.goto(`${BASE}/upgrade`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  // ---- The headline is a range -------------------------------------------
  const first = await preview(page)
  check('the card is priced as a range, not a fixed figure', first.heading === '65 – 139', first.heading)
  check('it opens at the floor of that range', first.chosen === '65', `GHS ${first.chosen}`)
  check('and previews what the floor buys', first.points === '150', `${first.points} pts an ad`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-initial.png` })

  // ---- The + button ------------------------------------------------------
  const plus = page.getByRole('button', { name: /raise by/i }).first()
  const minus = page.getByRole('button', { name: /lower by/i }).first()

  check('the minus is disabled at the floor', await minus.isDisabled(), 'nothing below GHS 65')

  await plus.click()
  await page.waitForTimeout(250)
  const afterOne = await preview(page)
  check('one tap of + moves the amount', afterOne.chosen === '70', `GHS ${afterOne.chosen}`)
  check('and the preview follows it', Number(afterOne.points) > Number(first.points),
    `${first.points} → ${afterOne.points} pts`)

  for (let i = 0; i < 3; i++) await plus.click()
  await page.waitForTimeout(250)
  const afterFour = await preview(page)
  check('four taps land where four taps should', afterFour.chosen === '85', `GHS ${afterFour.chosen}`)
  check('the per-day figure keeps up', afterFour.perDay !== first.perDay,
    `GHS ${first.perDay} → GHS ${afterFour.perDay} a day`)
  check('and the minus is live once off the floor', !(await minus.isDisabled()), 'enabled')

  await minus.click()
  await page.waitForTimeout(250)
  check('minus steps back by the same amount', (await preview(page)).chosen === '80', 'GHS 80')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-stepped.png` })

  // ---- The ceiling holds -------------------------------------------------
  /* Just BELOW the ceiling, so the next tap has somewhere to be clamped from.
     Setting it to the ceiling itself would only prove the button disables. */
  await page.evaluate(() => {
    const el = document.querySelector('input[type="range"]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, '13700')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(250)
  await plus.click()
  await page.waitForTimeout(250)
  const atTop = await preview(page)
  check('+ cannot push past the top of the band', atTop.chosen === '139', `GHS ${atTop.chosen}`)
  check('the plus is disabled there', await plus.isDisabled(), 'nothing above GHS 139')
  check('the top of the band pays what it should', atTop.points === '199', `${atTop.points} pts`)

  // ---- The notice --------------------------------------------------------
  // A fresh page, so nothing has been touched on it.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /get bronze/i }).click()
  await page.waitForTimeout(500)
  const dialog = page.getByRole('alertdialog')
  check('buying without choosing explains that the price is theirs', (await dialog.count()) > 0,
    (await dialog.innerText().catch(() => '')).split('\n')[0])

  /* WHERE it landed, not merely that it exists. A "full-screen" overlay
     rendered inside a transformed ancestor is positioned against that
     ancestor, so it can sit far below the fold while every role and text
     assertion still passes — a dimmed screen with the dialog nowhere in
     sight. */
  const box = await dialog.boundingBox()
  const viewport = page.viewportSize()
  check(
    'and it is actually on the screen',
    Boolean(box) && box.y >= 0 && box.y + box.height <= viewport.height + 1,
    box ? `y ${Math.round(box.y)}..${Math.round(box.y + box.height)} of ${viewport.height}` : 'no box',
  )
  const noticeText = (await dialog.innerText()).replace(/\s+/g, ' ')
  check('it names the range', /65.*139/.test(noticeText), noticeText.slice(0, 90))
  check('and says the ad count does not change', /does not change/i.test(noticeText), 'reassurance shown')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-notice.png` })

  /* Escape is the way out that nobody has to be taught, and the focus has to
     be INSIDE the dialog for the key to reach it in the first place — a modal
     that leaves focus on the card behind it sends the next Tab somewhere
     invisible. */
  check('the notice takes focus when it opens', await page.evaluate(
    () => document.activeElement?.getAttribute('role') === 'alertdialog'), 'dialog focused')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('escape closes it', (await page.getByRole('alertdialog').count()) === 0, 'closed')
  check('and escape buys nothing', page.url().includes('/upgrade'), page.url().split('/').pop())

  // Escape is "not now", so the notice is still owed to them.
  await page.getByRole('button', { name: /get bronze/i }).click()
  await page.waitForTimeout(400)
  check('and it comes back, having settled nothing',
    (await page.getByRole('alertdialog').count()) > 0, 'shown again')

  // "Set my amount" returns them to the control rather than buying.
  await page.getByRole('button', { name: /set my amount/i }).click()
  await page.waitForTimeout(400)
  check('choosing to adjust does not buy anything', (await page.getByRole('alertdialog').count()) === 0,
    'the notice closed')
  check('and it puts the cursor on the slider', await page.evaluate(
    () => document.activeElement?.getAttribute('type') === 'range'), 'slider focused')

  // Once they HAVE touched it, the notice stays out of the way.
  await plus.click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: /get bronze/i }).click()
  await page.waitForTimeout(600)
  check('after adjusting, the button just works', (await page.getByRole('alertdialog').count()) === 0,
    'no second lecture')

  // ---- "Don't show this again" -------------------------------------------
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /get bronze/i }).click()
  await page.waitForTimeout(400)
  await page.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: /continue at/i }).click()
  await page.waitForTimeout(600)

  const remembered = await page.evaluate(() =>
    window.localStorage.getItem('sideperks.flexiblePricingNotice'),
  )
  check('asking not to see it again is remembered', remembered === 'dismissed', remembered)

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /get bronze/i }).click()
  await page.waitForTimeout(600)
  check('and it is not shown again', (await page.getByRole('alertdialog').count()) === 0, 'stayed away')

  check('no page errors', errors.length === 0, errors[0])

  console.log('')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  try {
    if (userId) await db.query(`delete from auth.users where id = $1`, [userId])
    const { rows } = await db.query(`select count(*)::int n from auth.users where id = $1`, [userId])
    console.log(`cleanup: ${rows[0].n} user(s) left`)
    if (rows[0].n !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId)
    process.exitCode = 1
  }
  await db.end()
}
