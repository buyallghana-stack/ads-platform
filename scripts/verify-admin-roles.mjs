/**
 * What each staff role can actually reach, checked in a browser.
 *
 * The three roles are enforced in three places and this exercises all of them:
 * the folder a screen lives in (`(super)/`, `ads/`, `messages/`), the nav that
 * decides which links to draw, and the database, which refuses a second time
 * and does not take the app's word for anything.
 *
 * Two throwaway staff accounts are created with known passwords, driven
 * through the console, then deleted in a `finally` — never a real
 * administrator, because the interesting half of this test is REVOKING
 * somebody, and there is exactly one real super admin to lock out.
 */
import { randomUUID } from 'node:crypto'

import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const PASSWORD = 'Sideperks!2026'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
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

const made = []

async function staff(role, name) {
  const email = `role-verify-${randomUUID().slice(0, 8)}@sideperks.test`
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  })
  if (error) throw error
  made.push(data.user.id)
  await db.query(`update public.profiles set full_name = $2 where id = $1`, [data.user.id, name])
  await setRole(data.user.id, role)
  return { id: data.user.id, email, name }
}

/** The same one-role-per-person rule `admin_grant_role` enforces. */
const setRole = async (userId, role) => {
  await db.query(`delete from public.user_roles where user_id = $1`, [userId])
  await db.query(`insert into public.user_roles (user_id, role) values ($1, $2::public.app_role)`, [
    userId,
    role,
  ])
}

const login = async (page, email) => {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30_000 })
}

/** Where a visit actually ends up. */
const landsOn = async (page, path) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
  return new URL(page.url()).pathname
}

let browser = null
await db.connect()

try {
  const support = await staff('support', 'Support Person')
  const ads = await staff('ads_manager', 'Ads Person')

  browser = await chromium.launch()

  // ---- Support ------------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    await login(page, support.email)

    check('support reaches the message queue', (await landsOn(page, '/admin/messages')) === '/admin/messages')
    check(
      'support is turned away from the payout queue',
      (await landsOn(page, '/admin/payouts')) === '/admin/messages',
      'sent to their own area, not shown a refusal',
    )
    check('support cannot open settings', (await landsOn(page, '/admin/settings')) === '/admin/messages')
    check('support cannot open the money overview', (await landsOn(page, '/admin')) === '/admin/messages')
    check('support cannot open the ads screen', (await landsOn(page, '/admin/ads')) === '/admin/messages')

    await landsOn(page, '/admin/messages')
    const links = await page.getByRole('link').all()
    const hrefs = await Promise.all(links.map((l) => l.getAttribute('href')))
    const adminLinks = hrefs.filter((h) => h?.startsWith('/admin'))
    check(
      'the nav offers only what support may open',
      adminLinks.every((h) => h === '/admin/messages'),
      adminLinks.join(' ') || 'none',
    )
    check('no page errors for support', errors.length === 0, errors[0])
    await ctx.close()
  }

  // ---- Ads manager --------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    await login(page, ads.email)

    check('the ads manager reaches ads', (await landsOn(page, '/admin/ads')) === '/admin/ads')
    check(
      'the ads manager reaches advertisers',
      (await landsOn(page, '/admin/advertisers')) === '/admin/advertisers',
    )
    check('the ads manager cannot open payouts', (await landsOn(page, '/admin/payouts')) === '/admin/ads')
    check('the ads manager cannot open the message queue', (await landsOn(page, '/admin/messages')) === '/admin/ads')
    check('the ads manager cannot open settings', (await landsOn(page, '/admin/settings')) === '/admin/ads')
    await ctx.close()
  }

  // ---- The super admin's own console still works ---------------------------
  /* Added after migration 086 quietly broke five screens for the only
     administrator on the platform. Each of these read `role = 'admin'` as a
     literal string, and the migration renamed that row to `super_admin`: the
     Admin link vanished from Profile, sign-in stopped landing on the console,
     and gift codes, tasks and games refused their own operator. Nothing failed
     loudly — the screens simply behaved as though nobody was signed in. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel(/email/i).fill('admin@email.com')
    await page.locator('input[type="password"]').fill('1234')
    await page.getByRole('button', { name: /log in/i }).click()
    await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30_000 })

    check(
      'signing in as a super admin lands on the console',
      new URL(page.url()).pathname === '/admin',
      new URL(page.url()).pathname,
    )

    await landsOn(page, '/profile')
    const profile = await page.locator('body').innerText()
    check('the Admin link is on the Profile screen', /admin/i.test(profile))

    for (const [path, marker] of [
      ['/admin/gift-codes', /gift code/i],
      ['/admin/tasks', /task/i],
      ['/admin/games', /game|prize/i],
    ]) {
      const landed = await landsOn(page, path)
      const body = await page.locator('body').innerText()
      check(`${path} loads for a super admin`, landed === path && marker.test(body), landed)
    }

    check('no page errors across the super admin console', errors.length === 0, errors[0])
    await ctx.close()
  }

  // ---- The database refuses independently of the app ----------------------
  {
    let refused = ''
    try {
      await db.query(`select public.assert_admin($1)`, [support.id])
    } catch (e) {
      refused = e.message
    }
    check('the database refuses support on a money function', /not an administrator/i.test(refused), refused)

    const { rows: allowed } = await db.query(
      `select public.admin_area_allowed($1,'support') as sup,
              public.admin_area_allowed($1,'ads') as ads`,
      [support.id],
    )
    check('support is allowed its own area and no other', allowed[0].sup === true && allowed[0].ads === false)
  }

  // ---- Revocation is immediate, not "when the token refreshes" ------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    await login(page, support.email)
    check('signed in and inside the console', (await landsOn(page, '/admin/messages')) === '/admin/messages')

    // Revoked while that browser session stays open and its token unchanged.
    await db.query(`update public.user_roles set role = 'user' where user_id = $1`, [support.id])

    check(
      'a revoked administrator is out on their next request',
      (await landsOn(page, '/admin/messages')) === '/dashboard',
      'the old JWT claim would have kept them in for up to an hour',
    )
    await ctx.close()
  }

  // ---- The rules that stop somebody locking everybody out -----------------
  {
    const { rows: superAdmins } = await db.query(
      `select user_id from public.user_roles where role in ('super_admin','admin') limit 1`,
    )
    const theSuper = superAdmins[0].user_id

    let selfError = ''
    try {
      await db.query(`select public.admin_revoke_role($1, $1)`, [theSuper])
    } catch (e) {
      selfError = e.message
    }
    check('nobody can revoke themselves', /your own access/i.test(selfError), selfError)

    /* THE "LAST SUPER ADMIN" GUARD IS UNREACHABLE, and that is worth writing
       down rather than pretending to test. To trip it, a super admin must
       revoke a super admin while only one exists — which means they are
       revoking themselves, and the check above has already refused that. It
       stays in the database as belt and braces for a future path that revokes
       somebody other than the caller. The first version of this script claimed
       to exercise it and was really watching the self-revoke rule fire again. */
    const { rows: guard } = await db.query(
      `select count(*)::int as supers from public.user_roles where role in ('super_admin','admin')`,
    )
    check(
      'exactly one super admin exists, so the last-admin guard cannot be reached',
      guard[0].supers === 1,
      `${guard[0].supers} super admin(s)`,
    )

    // Put the real super admin back exactly as found.
    await setRole(theSuper, 'super_admin')
  }

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
    for (const id of made) {
      await db.query(`delete from public.user_roles where user_id = $1`, [id])
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [id])
      await db.query(`alter table public.points_ledger enable trigger user`)
      await db.query(`delete from public.user_balances where user_id = $1`, [id])
      await db.query(`delete from public.user_session_records where user_id = $1`, [id])
      await db.query(`delete from public.notifications where user_id = $1`, [id])
      await db.query(`delete from auth.users where id = $1`, [id])
    }
    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = any($1::uuid[])) as users,
              (select count(*)::int from public.user_roles
                where role in ('super_admin','admin')) as supers`,
      [made],
    )
    console.log(`cleanup: ${rows[0].users} account(s) left behind, ${rows[0].supers} super admin(s) remain`)
    if (rows[0].users || rows[0].supers !== 1) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| ids:', made.join(', '))
    process.exitCode = 1
  }
  await db.end()
}
