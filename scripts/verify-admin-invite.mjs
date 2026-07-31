/**
 * An invited administrator can actually get in.
 *
 * WHAT WAS BROKEN, and for how long. Since 2026-07-25 the three email
 * templates that matter had been rewritten to point at our own /auth/confirm
 * route with `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=…`, but the
 * INVITE template was never touched — it was still Supabase's stock
 * `{{ .ConfirmationURL }}`, which goes to Supabase's own verify endpoint and
 * hands the session back in a URL FRAGMENT that no server route can read. That
 * did not matter until 2026-07-31, when adding an administrator by email
 * became a feature that depends on it. Fixed with a management-API PATCH.
 *
 * This mints a real invite token with `generateLink` — the same technique the
 * signup flow was verified with — builds the URL the TEMPLATE produces, and
 * walks it. No email is sent, so nothing depends on a mailbox and the Resend
 * quota is untouched.
 */
import { randomUUID } from 'node:crypto'

import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const NEXT = '/reset-password'

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

let userId = null
let browser = null
await db.connect()

try {
  const email = `invite-flow-${randomUUID().slice(0, 8)}@sideperks.test`
  const redirectTo = `${BASE}/auth/confirm?next=${NEXT}`

  const { data, error } = await sb.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  })
  if (error) throw error
  userId = data.user?.id ?? null
  check('an invitation creates the account', Boolean(userId))

  // Exactly what the template renders. If this shape is wrong the email is
  // wrong, whatever the link Supabase itself returns looks like.
  const link = `${redirectTo}&token_hash=${data.properties.hashed_token}&type=invite`
  check('the link points at our own confirm route', link.startsWith(`${BASE}/auth/confirm?`))

  // A super admin grants the role, the way the settings screen does.
  const { rows: supers } = await db.query(
    `select user_id from public.user_roles where role in ('super_admin','admin') limit 1`,
  )
  await db.query(`select public.admin_grant_role($1, $2, 'support')`, [supers[0].user_id, userId])
  const { rows: granted } = await db.query(`select public.admin_role($1) as role`, [userId])
  check('the role is granted whether or not the email lands', granted[0].role === 'support')

  const { rows: listed } = await db.query(
    `select accepted from public.admin_list_administrators() where id = $1`,
    [userId],
  )
  check('they are listed as invited, not as accepted', listed[0]?.accepted === false)

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(link, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const landed = new URL(page.url()).pathname

  /* THE PAGE MUST HAVE RENDERED, not merely have the right address. The
     first version of this check compared pathnames only — and /profile/credentials
     is a folder containing actions.ts and no page, so Next served its 404 AT
     that path and the assertion passed while every real invitation dead-ended.
     A 404 keeps the URL you asked for; that is exactly why the URL is not the
     thing to assert. */
  const body = await page.locator('body').innerText()
  const missing = /404|could not be found|page not found/i.test(body)
  check('the link signs them in and lands on the password screen', landed === NEXT, landed)
  check('that screen actually renders', !missing && body.length > 200, missing ? 'a 404 page' : `${body.length} chars`)
  check(
    'and it is a screen where a password can be set',
    (await page.locator('input[type="password"]').count()) > 0,
    'password field present',
  )
  check('no page errors on the way in', errors.length === 0, errors[0])

  // A second use must fail: an invitation is one link, once.
  const second = await browser.newContext()
  const secondPage = await second.newPage()
  await secondPage.goto(link, { waitUntil: 'networkidle' })
  const secondLanded = new URL(secondPage.url()).pathname + new URL(secondPage.url()).search
  check(
    'the same link cannot be used twice',
    !secondLanded.startsWith(NEXT),
    secondLanded,
  )
  await second.close()

  const { rows: after } = await db.query(
    `select accepted from public.admin_list_administrators() where id = $1`,
    [userId],
  )
  check('accepting the invitation shows on the list', after[0]?.accepted === true)

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
      await db.query(`delete from public.user_roles where user_id = $1`, [userId])
      await db.query(`delete from public.user_session_records where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger enable trigger user`)
      await db.query(`delete from public.user_balances where user_id = $1`, [userId])
      await db.query(`delete from public.notifications where user_id = $1`, [userId])
      await db.query(`delete from auth.users where id = $1`, [userId])
    }
    const { rows } = await db.query(`select count(*)::int as n from auth.users where id = $1`, [
      userId,
    ])
    console.log(`cleanup: ${rows[0].n} account(s) left behind`)
    if (rows[0].n) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId)
    process.exitCode = 1
  }
  await db.end()
}
