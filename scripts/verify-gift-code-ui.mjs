/**
 * Drives the two gift-code screens the way a person would: an admin creates a
 * code, a user redeems it, and the same code is then refused.
 *
 * Uses the demo admin to create (it is the account without an authenticator)
 * and a throwaway user to redeem. The throwaway earns points, so it is scrubbed
 * with the documented trigger-disable purge rather than left behind.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const ADMIN_EMAIL = 'admin@email.com'
const ADMIN_PASSWORD = '1234'

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
const USER_EMAIL = `gift-ui-${stamp}@test.invalid`
const USER_PASSWORD = `GiftUi!${stamp}`

let browser = null
let userId = null
let code = null

await db.connect()

const login = async (page, email, password) => {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/(dashboard|admin)(\/|$|\?)/, { timeout: 30_000 })
}

try {
  const { data: made, error } = await sb.auth.admin.createUser({
    email: USER_EMAIL,
    password: USER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Gift UI' },
  })
  if (error) throw error
  userId = made.user.id

  browser = await chromium.launch()

  // ---- Admin creates a code ---------------------------------------------
  const adminCtx = await browser.newContext()
  const admin = await adminCtx.newPage()
  const adminErrors = []
  admin.on('pageerror', (e) => adminErrors.push(e.message))

  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD)
  await admin.goto(`${BASE}/admin/gift-codes`)
  await admin.waitForLoadState('networkidle')
  await admin.getByRole('button', { name: /new gift code/i }).click()

  // The operator's requirement: the code appears while the points field is
  // there to type into — one form, not a generate step then a set step.
  const codeBox = admin.locator('output').first()
  await codeBox.waitFor({ timeout: 20_000 })
  for (let i = 0; i < 40 && !/^[0-9A-HJKMNP-TV-Z]{12}$/.test((await codeBox.innerText()).trim()); i++) {
    await admin.waitForTimeout(250)
  }
  code = (await codeBox.innerText()).trim()

  const pointsVisible = await admin.locator('#gc-points').isVisible()
  check(
    'the code is generated and the points field is there at the same time',
    /^[0-9A-HJKMNP-TV-Z]{12}$/.test(code) && pointsVisible,
    `${code}, points field ${pointsVisible ? 'present' : 'missing'}`,
  )

  const editable = await admin.locator('#gc-points').isEditable()
  const codeIsInput = (await admin.locator('output').first().evaluate((el) => el.tagName)) !== 'INPUT'
  check('the code cannot be typed over, the points can', codeIsInput && editable)

  await admin.locator('#gc-points').fill('3500')
  await admin.locator('#gc-note').fill('UI check')
  await admin.getByRole('button', { name: /create code/i }).click()

  /*
    Both layouts are in the DOM — the card list is `lg:hidden`, the table is
    `hidden lg:block`. `.first()` picked the hidden card and reported the
    product broken when it was not. Assert on whichever match is actually
    visible at this viewport.

    POLLED, NOT SLEPT. A fixed 2.5s wait passed on a warm server and failed on
    a cold one against the same working code — the row arrives with the
    revalidate, so wait for the row rather than for a guess at how long it
    takes.
  */
  const matches = admin.getByText(code, { exact: false })
  let listed = false
  for (let waited = 0; waited < 20_000 && !listed; waited += 500) {
    for (let i = 0; i < (await matches.count()); i++) {
      if (await matches.nth(i).isVisible()) listed = true
    }
    if (!listed) await admin.waitForTimeout(500)
  }
  check('the new code appears in the list', listed, `${await matches.count()} match(es) in DOM`)

  // ---- User redeems it ---------------------------------------------------
  const userCtx = await browser.newContext()
  const user = await userCtx.newPage()
  const userErrors = []
  user.on('pageerror', (e) => userErrors.push(e.message))

  await login(user, USER_EMAIL, USER_PASSWORD)

  // Reached from the shortcut row under the balance, not by typing a URL.
  await user.getByRole('link', { name: /gift code/i }).first().click()
  await user.waitForURL('**/gift-code', { timeout: 20_000 })
  check('the gift code shortcut opens the screen', true, user.url())

  await user.waitForLoadState('networkidle')
  // Lower case on purpose: people paste these out of WhatsApp.
  await user.locator('#gift-code').fill(code.toLowerCase())
  await user.getByRole('button', { name: /redeem code/i }).click()

  await user.getByText(/code redeemed/i).waitFor({ timeout: 25_000 }).catch(() => {})
  const redeemed = await user.getByText(/code redeemed/i).isVisible().catch(() => false)
  check('the user redeems it and sees the win', redeemed, redeemed ? '3,500 points' : 'no success screen')

  const { rows: bal } = await db.query(
    `select coalesce(balance,0)::int b from public.user_balances where user_id = $1`,
    [userId],
  )
  check('the points landed in the balance', (bal[0]?.b ?? 0) === 3500, `${bal[0]?.b ?? 0} pts`)

  /*
    ---- And the history says what it was ----------------------------------
    `LEDGER_KIND` had no `gift_code`, so the row fell through to the
    `?? 'adjustment'` default and told the user their gift was an "account
    correction". Asserted here rather than trusted, because the failure is
    invisible — a correctly credited balance under a wrong label.
  */
  await user.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  const historyRow = await user
    .getByText(/gift code redeemed/i)
    .first()
    .textContent()
    .catch(() => null)
  const saysAdjustment = await user
    .getByText(/account correction/i)
    .first()
    .isVisible()
    .catch(() => false)
  check(
    'the history calls it a gift code, not an adjustment',
    historyRow !== null && !saysAdjustment,
    historyRow ?? (saysAdjustment ? 'still labelled an account correction' : 'no gift row found'),
  )

  // ---- And it cannot be used again ---------------------------------------
  await user.goto(`${BASE}/gift-code`, { waitUntil: 'networkidle' })
  await user.locator('#gift-code').fill(code)
  await user.getByRole('button', { name: /redeem code/i }).click()
  await user.waitForTimeout(3000)

  const alert = await user.getByRole('alert').first().textContent().catch(() => '')
  check(
    'the same code is refused the second time',
    /already been used/i.test(alert ?? ''),
    (alert ?? '').trim() || 'no message',
  )

  check('no page errors on either screen', adminErrors.length === 0 && userErrors.length === 0,
    [...adminErrors, ...userErrors][0])

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
    if (userId) {
      await db.query(`delete from public.gift_code_redemptions where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger enable trigger user`)
      await db.query(`delete from public.user_balances where user_id = $1`, [userId])
      await db.query(`delete from public.notifications where user_id = $1`, [userId])
      await db.query(`delete from public.gift_code_attempts where user_id = $1`, [userId])
    }
    if (code) await db.query(`delete from public.gift_codes where code = $1`, [code])
    if (userId) await db.query(`delete from auth.users where id = $1`, [userId])

    const { rows } = await db.query(
      `select (select count(*)::int from public.gift_codes where code = $1) codes,
              (select count(*)::int from auth.users where id = $2) users`,
      [code, userId],
    )
    console.log(`cleanup: ${rows[0].codes} code(s), ${rows[0].users} user(s) left behind`)
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| code:', code, '| user:', userId)
    process.exitCode = 1
  }
  await db.end()
}
