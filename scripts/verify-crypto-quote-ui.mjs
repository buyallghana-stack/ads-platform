/**
 * Proves the withdraw wizard shows a REAL crypto estimate, and shows nothing
 * when there is no fresh rate.
 *
 * Uses a throwaway account with its own crypto payout details. Not
 * user@email.com, which is the only real account holding crypto details and
 * which carries the operator's own authenticator.
 *
 * Cleanup is via `finalise_account_deletion`, the app's own path: crediting
 * points writes append-only ledger rows, and a user with ledger rows cannot
 * be hard-deleted (ON DELETE RESTRICT). That function scrubs the person and
 * leaves the anonymous rows, which is exactly what it exists for.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const stamp = Date.now()
const EMAIL = `fx-check-${stamp}@test.invalid`
const PASSWORD = `FxCheck!${stamp}`

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

let userId = null
let browser = null

/** Account step: pick the crypto destination, then Continue. Selecting it is
 *  not the same as advancing — the wizard has an explicit next button. */
async function toAmountStep(page) {
  await page.getByText('USDT', { exact: false }).first().click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('input[inputmode="decimal"]').first().waitFor({ timeout: 20_000 })
}

await db.connect()

try {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'FX Check' },
  })
  if (error) throw error
  userId = created.user.id
  console.log('fixture', EMAIL)

  // Enough points to clear any threshold, plus a USDT/TRC20 destination.
  await db.query(`select public.credit_points($1, 200000, 'admin_adjustment', 'test', 'fx-check')`, [
    userId,
  ])
  const { rows: coin } = await db.query(
    `select c.id as coin_id, n.id as network_id
       from public.payout_coins c
       join public.payout_coin_networks n on n.coin_id = c.id
      where c.code = 'USDT' limit 1`,
  )
  await db.query(
    `insert into public.user_payout_details
       (user_id, method, coin_id, network_id, wallet_address)
     values ($1, 'crypto', $2, $3, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')`,
    [userId, coin[0].coin_id, coin[0].network_id],
  )

  browser = await chromium.launch()
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // Sign in and reach the amount step.
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email address', { exact: true }).fill(EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })

  await page.goto(`${BASE}/withdraw`)
  await page.waitForLoadState('networkidle')
  await toAmountStep(page)

  await page.locator('input[inputmode="decimal"]').first().fill('100000') // = GHS 100

  await page.waitForTimeout(1500)
  const body = await page.locator('main').innerText()

  // GHS 100 at the stored rates is ~8.57 USDT. The old constant said 9.57.
  const shows857 = /8\.5\d\s*USDT/.test(body)
  const shows957 = /9\.57/.test(body)
  const estimateLine = body.split('\n').find((l) => /USDT/.test(l) && /≈/.test(l)) ?? ''
  check('shows the real coin amount for GHS 100', shows857, estimateLine || 'no estimate line')
  check('no longer shows the hardcoded 10.45-rate figure', !shows957)
  check(
    'names the rate it used',
    /11\.6\d/.test(body),
    body.match(/GHS 11\.[^\n]*/)?.[0] ?? 'rate not shown',
  )
  check('labels the amount in the coin the user actually holds', /USDT/.test(body) && !/USDC/.test(body))

  // ---- Now age the rate out and confirm it shows NOTHING ----------------
  await db.query(`update public.fx_rates set fetched_at = now() - interval '200 hours'`)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await toAmountStep(page)
  await page.locator('input[inputmode="decimal"]').first().fill('100000')
  await page.waitForTimeout(1500)

  const stale = await page.locator('main').innerText()
  check(
    'a stale rate produces no figure at all, and says so',
    !/≈\s*\d/.test(stale) && /cannot show a crypto estimate/i.test(stale),
    /cannot show a crypto estimate/i.test(stale) ? 'explains why' : 'no explanation shown',
  )

  check('no console errors', consoleErrors.length === 0, consoleErrors[0])

  console.log('')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  // Put the rates back the way the cron left them.
  await db.query(`update public.fx_rates set fetched_at = now()`)
  if (userId) {
    await db.query(`select public.finalise_account_deletion($1)`, [userId]).catch(async () => {
      await admin.auth.admin.deleteUser(userId)
    })
    console.log('fixture scrubbed')
  }
  await db.end()
}
