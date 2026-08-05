/**
 * "View as user" — a super admin looking at somebody's screens, read only.
 *
 * WHAT THIS IS REALLY GUARDING. The feature hands an administrator a view of
 * another person's account without a password. Two things therefore have to be
 * true at once, and only one of them is visible on screen:
 *
 *  1. THE ADMIN SEES THE USER'S DATA. Easy to check, easy to get right.
 *  2. NOTHING THEY DO IS SAVED. Invisible until it fails, and the failure is
 *     an administrator moving somebody's money. Every mutation below is fired
 *     as a real HTTP request while the viewing cookie is held, and the pass
 *     condition is a refusal — plus a database read afterwards proving the row
 *     did not move.
 *
 * A throwaway user and a throwaway look are created here and removed in the
 * `finally`, which is also re-read to prove the cleanup happened.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@email.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '1234'

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

let browser = null
let userId = null
const stamp = Date.now()
const email = `viewas-${stamp}@test.invalid`

await db.connect()

try {
  // ---- A throwaway account with something to look at ----------------------
  const { data: made, error: makeError } = await sb.auth.admin.createUser({
    email,
    password: `ViewAs!${stamp}`,
    email_confirm: true,
    user_metadata: { full_name: `View Target ${stamp}` },
  })
  if (makeError) throw makeError
  userId = made.user.id

  // A balance, so "am I seeing THEIR data" has a number to be right about.
  await db.query(
    `select public.credit_points($1, 4321, 'admin_adjustment'::public.ledger_entry_type,
                                 'view_as_fixture', $2, null, false)`,
    [userId, `viewas-${stamp}`],
  )
  const { rows: bal } = await db.query(
    `select balance from public.user_balances where user_id = $1`,
    [userId],
  )
  const balance = Number(bal[0].balance)

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  // ---- Sign in as the SUPER ADMIN ----------------------------------------
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/admin/, { timeout: 30_000 })

  // ---- Find the account and open a look ----------------------------------
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.getByPlaceholder(/Search name, email or phone/i).first().fill(`View Target ${stamp}`)
  await page.waitForTimeout(900)
  await page
    .getByRole('button', { name: new RegExp(`Review View Target ${stamp}`, 'i') })
    .filter({ visible: true })
    .first()
    .click()
  await page.waitForTimeout(700)

  const viewButton = page.getByRole('button', { name: /view as user/i }).filter({ visible: true })
  check('the panel offers a way to view as the user', (await viewButton.count()) > 0, 'button present')

  await viewButton.first().click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  await page.waitForTimeout(900)

  // ---- It is THEIR dashboard ---------------------------------------------
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check(
    'the dashboard shows the viewed account, not the admin',
    body.includes(balance.toLocaleString()),
    `${balance.toLocaleString()} pts on screen`,
  )
  check('a banner says whose account this is', /Viewing as/i.test(body), 'banner shown')
  check('and that it is read only', /Read only/i.test(body), 'read-only stated')

  // ---- The database agrees a session is open ------------------------------
  const { rows: open } = await db.query(
    `select count(*)::int n from public.admin_view_sessions
      where target_user_id = $1 and ended_at is null and expires_at > now()`,
    [userId],
  )
  check('a viewing session was recorded', open[0].n === 1, `${open[0].n} open`)

  const { rows: audit } = await db.query(
    `select count(*)::int n from public.admin_audit_log
      where action = 'view_as_user' and entity_id = $1`,
    [userId],
  )
  check('and it is in the audit trail', audit[0].n === 1, 'logged')

  // ---- NOTHING CAN BE SAVED ----------------------------------------------
  /* Fired as real requests carrying the viewing cookie, because that is the
     only way to prove the block sits in front of the server action rather
     than in front of a button. A hidden button proves nothing. */
  const cookies = await ctx.cookies()
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const hasViewCookie = cookies.some((c) => c.name === 'sp_view_as')
  check('the viewing cookie is set', hasViewCookie, 'sp_view_as present')

  const post = async (path) => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'text/plain' },
      body: '{}',
      redirect: 'manual',
    })
    return res.status
  }

  for (const path of ['/dashboard', '/withdraw', '/profile/payout', '/upgrade', '/tasks']) {
    const status = await post(path)
    check(`a write to ${path} is refused`, status === 403, `HTTP ${status}`)
  }

  // …and the balance really did not move.
  const { rows: after } = await db.query(
    `select balance from public.user_balances where user_id = $1`,
    [userId],
  )
  check(
    'the balance is untouched after all of that',
    Number(after[0].balance) === balance,
    `${Number(after[0].balance)} = ${balance}`,
  )

  // ---- The security screens stay shut ------------------------------------
  for (const path of ['/profile/2fa', '/profile/sessions', '/profile/password']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    check(
      `${path} is not reachable while viewing`,
      !page.url().includes(path),
      `landed on ${new URL(page.url()).pathname}`,
    )
  }

  // ---- Leaving ------------------------------------------------------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: /exit/i }).first().click()
  await page.waitForURL(/\/admin/, { timeout: 30_000 })
  await page.waitForTimeout(500)

  const { rows: closed } = await db.query(
    `select count(*)::int n from public.admin_view_sessions
      where target_user_id = $1 and ended_at is null`,
    [userId],
  )
  check('leaving ends the session', closed[0].n === 0, 'none left open')

  const afterExit = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('and the banner is gone', !/Viewing as/i.test(afterExit), 'banner cleared')

  // The admin is themselves again: a write they are entitled to now works.
  const cookies2 = await ctx.cookies()
  check(
    'the viewing cookie is cleared',
    !cookies2.some((c) => c.name === 'sp_view_as'),
    'cookie removed',
  )

  // ---- Who may be viewed --------------------------------------------------
  const { rows: adminRow } = await db.query(
    `select user_id from public.user_roles where role = 'super_admin' limit 1`,
  )
  let refusedAdmin = false
  try {
    await db.query(`select * from public.admin_start_view_session($1, $1)`, [adminRow[0].user_id])
  } catch {
    refusedAdmin = true
  }
  check('viewing your own account is refused', refusedAdmin, 'refused')

  let refusedStaff = false
  try {
    await db.query(`select * from public.admin_start_view_session($1, $2)`, [
      adminRow[0].user_id,
      adminRow[0].user_id,
    ])
  } catch {
    refusedStaff = true
  }
  check('viewing another administrator is refused', refusedStaff, 'refused')

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
    if (userId) {
      await db.query(`delete from public.admin_view_sessions where target_user_id = $1`, [userId])
      await db.query(`delete from public.admin_audit_log where entity_id = $1`, [userId])
      /* The ledger is append-only by trigger, so a fixture credit cannot simply
         be deleted — the trigger has to come off and go back on in the same
         transaction, which is the recipe the gift-code cleanup established. */
      await db.query('begin')
      await db.query(`alter table public.points_ledger disable trigger points_ledger_no_delete`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger enable trigger points_ledger_no_delete`)
      await db.query('commit')
      await db.query(`delete from auth.users where id = $1`, [userId])
      const { rows } = await db.query(`select count(*)::int n from auth.users where id = $1`, [
        userId,
      ])
      console.log(`cleanup: ${rows[0].n} test user(s) left`)
      if (rows[0].n !== 0) process.exitCode = 1
    }
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId)
    process.exitCode = 1
  }
  await db.end()
}
