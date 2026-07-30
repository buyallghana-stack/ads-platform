/**
 * Drives the tasks screen: a user with real history sees finished tasks,
 * claims one, and the points land.
 *
 * The throwaway player is given ledger history so several tasks are already
 * complete — which is also the point of the operator's retroactive choice, so
 * the fixture and the feature are testing the same idea.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? ''

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const stamp = Date.now()
const EMAIL = `tasks-${stamp}@test.invalid`
const PASSWORD = `Tasks!${stamp}`
let browser = null
let userId = null

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
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: 'Task Tester' },
  })
  if (error) throw error
  userId = data.user.id

  // 12 ad views, so "watch 10 ads" is already done — retroactive by design.
  for (let i = 0; i < 12; i++) {
    await db.query(`select public.credit_points($1, 100, 'ad_view')`, [userId])
  }

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await login(page, EMAIL, PASSWORD)

  // Reached from the shortcut row.
  await page.getByRole('link', { name: /^tasks$/i }).first().click()
  await page.waitForURL('**/tasks', { timeout: 20_000 })
  await page.getByRole('heading', { name: /^tasks$/i }).first().waitFor({ timeout: 20_000 })
  check('the Tasks tile opens the screen', true, page.url())

  const body = await page.locator('body').innerText()
  check('descriptions are shown', /just by joining us/i.test(body), 'Newbie description present')
  check('a summary of what is claimable is shown', /ready to claim/i.test(body),
    body.split('\n').find((l) => /ready to claim/i.test(l)) ?? 'not found')

  // A part-finished task must show a bar with real numbers on it.
  check('progress is shown for a counted task', /12 of 100/.test(body), '12 of 100 (Regular)')
  await shootPage(page, 'tasks-mobile')

  const before = await db.query(
    `select coalesce(balance,0)::int b from public.user_balances where user_id = $1`, [userId],
  ).then((r) => r.rows[0]?.b ?? 0)

  const claimButtons = await page.getByRole('button', { name: /^claim$/i }).count()
  check('finished tasks offer a claim button', claimButtons > 0, `${claimButtons} claimable`)

  await page.getByRole('button', { name: /^claim$/i }).first().click()
  await page.getByText(/claimed!/i).waitFor({ timeout: 25_000 })
  check('claiming reports the reward', true, 'confirmation shown')
  await shootPage(page, 'tasks-claimed-mobile')

  const after = await db.query(
    `select coalesce(balance,0)::int b from public.user_balances where user_id = $1`, [userId],
  ).then((r) => r.rows[0]?.b ?? 0)
  const { rows: completion } = await db.query(
    `select reward_points, progress_at_claim from public.task_completions where user_id = $1`, [userId],
  )
  check('exactly one completion was written', completion.length === 1, `${completion.length} row(s)`)
  check('the points reached the balance',
    after - before === Number(completion[0]?.reward_points ?? -1),
    `+${after - before} pts`)

  const { rows: ledger } = await db.query(
    `select count(*)::int n from public.points_ledger where user_id = $1 and entry_type = 'task_reward'`,
    [userId],
  )
  check('one task_reward ledger row', ledger[0].n === 1, `${ledger[0].n} row(s)`)

  // A claimed task stays on the screen as evidence, greyed.
  const afterText = await page.locator('body').innerText()
  check('the claimed task stays visible', /claimed/i.test(afterText), 'still listed')

  check('no page errors', errors.length === 0, errors[0])
  await ctx.close()

  // ---- Admin -------------------------------------------------------------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const admin = await adminCtx.newPage()
  const adminErrors = []
  admin.on('pageerror', (e) => adminErrors.push(e.message))
  await login(admin, 'admin@email.com', '1234')
  await admin.goto(`${BASE}/admin/tasks`, { waitUntil: 'networkidle' })

  const adminText = await admin.locator('body').innerText()
  check('the admin lists the tasks', /Newbie/.test(adminText), 'seeded tasks listed')
  check('the admin sees how many can claim now', /can claim now/i.test(adminText), 'eligible count shown')
  await shootPage(admin, 'tasks-admin-desktop')
  check('no page errors on the admin screen', adminErrors.length === 0, adminErrors[0])
  await adminCtx.close()

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
      await db.query(`delete from public.task_completions where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger enable trigger user`)
      await db.query(`delete from public.user_balances where user_id = $1`, [userId])
      await db.query(`delete from public.notifications where user_id = $1`, [userId])
      await db.query(`delete from auth.users where id = $1`, [userId])
    }
    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = $1) users,
              (select count(*)::int from public.task_completions where user_id = $1) completions,
              (select count(*)::int from pg_trigger
                where tgrelid = 'public.points_ledger'::regclass
                  and tgenabled <> 'O' and not tgisinternal) disabled_triggers`,
      [userId],
    )
    console.log(`cleanup: ${rows[0].users} user(s), ${rows[0].completions} completion(s), ${rows[0].disabled_triggers} disabled trigger(s)`)
    if (rows[0].users !== 0 || rows[0].disabled_triggers !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId)
    process.exitCode = 1
  }
  await db.end()
}

async function shootPage(page, name) {
  if (!SHOTS) return
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}
