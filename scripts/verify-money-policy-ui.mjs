/**
 * The three money policies of 2026-08-01, seen the way a user sees them.
 *
 *   the free window          earning stops after N days, and the Ads tab says
 *                            so instead of offering ads that cannot pay
 *   one withdrawal minimum   the same number for a free account and a
 *                            Platinum holder, on the screen and in the refusal
 *   the fee                  shown BEFORE anybody confirms, and matching what
 *                            the database freezes onto the request
 *
 * The vitest suite proves the database refuses correctly. This proves the
 * screens tell the truth about it — which is a different failure, and the more
 * expensive one: a user who is told they will receive GHS 10 and is sent GHS
 * 9.75 has been misled by software that was working perfectly.
 *
 * Every setting it changes is restored in the `finally`, and re-read
 * afterwards rather than assumed — this runs against the shared project, where
 * a config key left flipped is a live money setting left flipped.
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
const EMAIL = `policy-${stamp}@test.invalid`
const PASSWORD = `Policy!${stamp}`
let userId = null
let browser = null

/** Config touched by this run, restored whatever happens. */
const KEYS = ['redemption_fee_percent', 'redemption_minimum_points', 'free_earning_days']
const original = new Map()

await db.connect()

const setKey = (key, value) => db.query(`update public.app_config set value = $2 where key = $1`, [key, value])

const login = async (page) => {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

try {
  for (const key of KEYS) {
    const { rows } = await db.query(`select value from public.app_config where key = $1`, [key])
    if (!rows.length) throw new Error(`${key} is missing — the migration has not been applied`)
    original.set(key, rows[0].value)
  }
  console.log(`settings before: ${[...original].map(([k, v]) => `${k}=${v}`).join(', ')}\n`)

  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Policy Tester' },
  })
  if (error) throw error
  userId = data.user.id

  // Enough to withdraw, and payout details old enough to clear the cool-off.
  await db.query(`select public.credit_points($1, 12000, 'admin_adjustment')`, [userId])
  await db.query(
    `update public.payout_providers set rail_confirmed = true, is_active = true where code = 'MTN_MOMO'`,
  )
  await db.query(
    `select public.set_payout_details($1, 'mobile_money', null, null, null,
       (select id from public.payout_providers where code = 'MTN_MOMO'), '0244000999', 'Policy Tester')`,
    [userId],
  )
  await db.query(
    `update public.user_payout_details set last_changed_at = now() - interval '400 hours' where user_id = $1`,
    [userId],
  )

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await login(page)

  // ---- 1. The fee, before confirming ------------------------------------
  await setKey('redemption_fee_percent', '2.5')
  await setKey('redemption_minimum_points', '5000')
  await page.goto(`${BASE}/withdraw`, { waitUntil: 'networkidle' })

  /* The payout accounts are radios, not buttons — a `getByRole('button')`
     here silently matches nothing and leaves the wizard on step one. */
  await page.locator('[role="radio"]').first().click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /continue|next/i }).first().click()
  await page.waitForTimeout(600)

  // Ask for 10,000 points = GHS 10.00 at the seeded rate.
  const amountField = page.locator('input[inputmode="decimal"], input[type="text"]').first()
  await amountField.fill('10000')
  await page.waitForTimeout(500)
  const amountText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check(
    'the amount step says what will actually arrive',
    /receive GHS 9\.75 after the 2\.5% fee/i.test(amountText),
    amountText.match(/receive GHS [\d.]+ after the [\d.]+% fee/i)?.[0] ?? 'not shown',
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/fee-amount-step.png` })

  await page.getByRole('button', { name: /continue|next/i }).first().click()
  await page.waitForTimeout(700)
  const confirmText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('the confirm step shows the fee itself', /GHS 0\.25 \(2\.5%\)/.test(confirmText),
    confirmText.match(/− ?GHS [\d.]+ \([\d.]+%\)/)?.[0] ?? 'not shown')
  check('and the net beside it', /You receive GHS 9\.75/i.test(confirmText),
    confirmText.match(/You receive GHS [\d.]+/i)?.[0] ?? 'not shown')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/fee-confirm-step.png` })

  // ---- 2. What the database froze ---------------------------------------
  const { rows: made } = await db.query(
    `select * from public.request_redemption($1, 'mobile_money', 10000)`,
    [userId],
  )
  const { rows: row } = await db.query(`select * from public.redemptions where id = $1`, [
    made[0].redemption_id ?? made[0].id,
  ])
  check('the request stores the same fee the screen quoted', Number(row[0].fee_amount) === 0.25,
    `GHS ${row[0].fee_amount} at ${row[0].fee_percent}%`)
  check('and the net the operator must send', Number(row[0].net_amount) === 9.75, `GHS ${row[0].net_amount}`)

  // ---- 3. One minimum, whatever the plan --------------------------------
  await setKey('redemption_minimum_points', '4000')
  const { rows: mins } = await db.query(
    `select (public.resolve_user_tier($1)).redemption_minimum_points as free_min,
            (select min(redemption_minimum_points) from public.tiers where not is_default) as old_plan_min`,
    [userId],
  )
  check('the resolver answers from the setting, not the plan column',
    Number(mins[0].free_min) === 4000,
    `resolver ${mins[0].free_min}, plans still hold ${mins[0].old_plan_min}`)

  await page.goto(`${BASE}/withdraw`, { waitUntil: 'networkidle' })
  const minText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('the withdraw screen shows that number', /4,000/.test(minText),
    minText.match(/[\d,]+ points?/)?.[0] ?? 'not shown')

  // The plan cards must no longer sell a threshold that is the same for all.
  await page.goto(`${BASE}/upgrade`, { waitUntil: 'networkidle' })
  const upgradeText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('the plan cards no longer advertise their own threshold',
    !/withdraw from/i.test(upgradeText), 'no per-plan threshold listed')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/plans-no-threshold.png`, fullPage: true })

  // ---- 4. The free window ------------------------------------------------
  await page.goto(`${BASE}/ads`, { waitUntil: 'networkidle' })
  check('a new free account can still watch ads',
    (await page.getByRole('tab', { name: /videos/i }).count()) > 0, 'the feed is there')

  // Age the account past the window.
  await db.query(`update public.profiles set created_at = now() - interval '40 days' where id = $1`, [userId])
  await page.reload({ waitUntil: 'networkidle' })
  const blockedText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('once the window closes the Ads tab says so', /free days are over/i.test(blockedText),
    blockedText.slice(0, 80))
  check('it offers the way out', /see the plans/i.test(blockedText), 'plans CTA shown')
  check('and says the points are still theirs', /stay yours/i.test(blockedText), 'reassurance shown')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/free-window-over.png` })

  // A plan lifts it, which is the whole offer.
  await db.query(
    `insert into public.user_subscriptions (user_id, tier_id, status, started_at, current_period_end)
     select $1, t.id, 'active', now(), now() + interval '30 days' from public.tiers t where t.slug = 'bronze'`,
    [userId],
  )
  await page.reload({ waitUntil: 'networkidle' })
  check('buying a plan brings the ads back',
    (await page.getByRole('tab', { name: /videos/i }).count()) > 0, 'the feed is back')

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
    for (const [key, value] of original) await setKey(key, value)
    const { rows: back } = await db.query(
      `select key, value from public.app_config where key = any($1) order by key`,
      [KEYS],
    )
    const restored = back.every((r) => r.value === original.get(r.key))
    console.log(`settings after:  ${back.map((r) => `${r.key}=${r.value}`).join(', ')}`)
    if (!restored) {
      console.error('SETTINGS NOT RESTORED — a live money setting is still changed')
      process.exitCode = 1
    }

    if (userId) {
      await db.query(`delete from public.redemptions where user_id = $1`, [userId])
      await db.query(`delete from public.user_subscriptions where user_id = $1`, [userId])
      await db.query(`delete from public.user_payout_details where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger enable trigger user`)
      for (const table of ['user_balances', 'daily_earning_counters', 'notifications', 'fraud_signals']) {
        await db.query(`delete from public.${table} where user_id = $1`, [userId])
      }
      await db.query(`delete from auth.users where id = $1`, [userId])
    }
    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = $1) users,
              (select count(*)::int from pg_trigger
                where tgrelid = 'public.points_ledger'::regclass
                  and tgenabled <> 'O' and not tgisinternal) disabled_triggers`,
      [userId],
    )
    console.log(`cleanup: ${rows[0].users} user(s), ${rows[0].disabled_triggers} disabled trigger(s)`)
    if (rows[0].users !== 0 || rows[0].disabled_triggers !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId)
    process.exitCode = 1
  }
  await db.end()
}
