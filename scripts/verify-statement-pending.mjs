/**
 * An abandoned checkout must not appear in the statement.
 *
 * The bug, reported 2026-07-31: the operator bought Silver on their .icloud
 * account, it went through (confirmed 16:30:05, plan active) — and the
 * statement still showed "pending". It was showing a DIFFERENT payment row:
 * an attempt started two minutes earlier that was never completed. Paystack's
 * verify endpoint calls both of the pending rows in this database `abandoned`,
 * "The transaction was not completed", so no money was ever taken for them.
 *
 * A pending row is a checkout somebody opened, not money that moved, and it
 * lives forever because nothing ever comes back to close it. This proves the
 * statement now lists only payments that completed.
 *
 * Throwaway account, deleted in a `finally`, verified afterwards.
 */
import { randomUUID } from 'node:crypto'

import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const PASSWORD = 'Sideperks!2026'
const EMAIL = `statement-verify-${randomUUID().slice(0, 8)}@sideperks.test`

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
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Statement Verify' },
  })
  if (error) throw error
  userId = data.user.id

  // One completed purchase, and one abandoned checkout — the exact pair the
  // .icloud account had.
  const startPayment = async (slug) => {
    const { rows } = await db.query(
      `insert into public.subscription_payments (user_id, tier_id, method, status, amount_minor, period_days)
       select $1, t.id, 'paystack', 'pending', t.price_minor, t.billing_period_days
         from public.tiers t where t.slug = $2
       returning id`,
      [userId, slug],
    )
    return rows[0].id
  }

  const abandoned = await startPayment('silver')
  const completed = await startPayment('silver')
  await db.query(`select public.confirm_subscription_payment($1, $2, '{}'::jsonb)`, [
    completed,
    `verify-${completed}`,
  ])

  const { rows: state } = await db.query(
    `select status, count(*)::int as n from public.subscription_payments
      where user_id = $1 group by status order by status`,
    [userId],
  )
  check(
    'the database still holds both rows',
    state.length === 2,
    state.map((r) => `${r.status}:${r.n}`).join(' '),
  )

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  await page.waitForTimeout(800)

  const body = await page.locator('body').innerText()
  const subscriptionLines = (body.match(/Subscription/gi) ?? []).length

  check('the abandoned checkout is not in the statement', !/pending/i.test(body))
  check(
    'the completed purchase still is',
    subscriptionLines >= 1,
    `${subscriptionLines} subscription row(s)`,
  )
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
      await db.query(`delete from public.user_subscriptions where user_id = $1`, [userId])
      await db.query(`delete from public.subscription_payments where user_id = $1`, [userId])
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
