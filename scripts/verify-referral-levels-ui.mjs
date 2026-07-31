/**
 * The three second-level referral settings are reachable, and one of them
 * round-trips to the database.
 *
 * The settings screen renders a HAND-WRITTEN field list, not every row in
 * `app_config`, so a config row nobody adds a field for is a setting nobody
 * can reach — the trap `verify-config-fields.mjs` was written for. Migration
 * 083 adds three more rows, and a second referral level that only the database
 * can switch on is not a feature.
 *
 * WHICH KEY THE SAVE TEST USES, AND WHY IT IS SAFE. It flips
 * `referral_purchase_commission_percent_l2`, which is a money setting on a
 * shared project the operator uses live. It is safe here only because a
 * second-level commission needs a two-deep referral chain, and the script
 * refuses to run unless the database has none — checked, not assumed. The
 * value is restored in a `finally`, and the restore is verified.
 */
import { chromium } from '@playwright/test'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const KEY = 'referral_purchase_commission_percent_l2'

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const KEYS = [
  'referral_signup_bonus_points_l2',
  'referral_activation_bonus_points_l2',
  'referral_purchase_commission_percent_l2',
]

let browser = null
let restore = null
await db.connect()

try {
  // ---- The precondition that makes flipping a money setting safe ---------
  const { rows: chains } = await db.query(`
    select count(*)::int as n
      from public.referrals a
      join public.referrals b on b.referee_id = a.referrer_id
     where a.status <> 'rejected' and b.status <> 'rejected'`)
  if (chains[0].n !== 0) {
    throw new Error(
      `${chains[0].n} two-deep referral chains exist — flipping ${KEY} could pay a real commission. Refusing.`,
    )
  }
  check('no live two-deep chain exists, so the save test cannot pay anybody', true)

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill('admin@email.com')
  await page.locator('input[type="password"]').fill('1234')
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/admin/, { timeout: 30_000 })

  await page.goto(`${BASE}/admin/config`, { waitUntil: 'networkidle' })
  const body = await page.locator('body').innerText()

  // The screen prints each column name under its label, which is what makes
  // this checkable at all.
  for (const key of KEYS) {
    check(`${key} is on the settings screen`, body.includes(key))
  }

  check(
    'the second level is described as a second level, not as a duplicate field',
    /second level/i.test(body),
    'wording present',
  )

  // The correction shipped in the same change: the first-level description
  // claimed a plan multiplied the commission, which stopped being true on
  // 2026-07-30 when referral bonuses went flat.
  check(
    'the stale "your plan multiplies it" claim is gone from the commission field',
    !/times their referral multiplier/i.test(body),
    'flat wording',
  )

  // ---- A save must actually reach the database ---------------------------
  const { rows: before } = await db.query(`select value from public.app_config where key = $1`, [
    KEY,
  ])
  restore = before[0].value
  const next = String(Number(restore) === 3 ? 4 : 3)

  await page.getByLabel(/commission, second level/i).fill(next)
  await page.getByRole('button', { name: /save/i }).first().click()
  await page.waitForTimeout(2500)

  const { rows: after } = await db.query(`select value from public.app_config where key = $1`, [KEY])
  check(
    'saving the second-level commission writes it to the database',
    after[0].value === next,
    `${restore} -> ${after[0].value}`,
  )

  check('no page errors on the settings screen', errors.length === 0, errors[0])

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
    if (restore !== null) {
      await db.query(`update public.app_config set value = $1 where key = $2`, [restore, KEY])
      const { rows } = await db.query(`select value from public.app_config where key = $1`, [KEY])
      console.log(`restored ${KEY} = ${rows[0].value}`)
      if (rows[0].value !== restore) process.exitCode = 1
    }
  } catch (e) {
    console.error('RESTORE FAILED —', e.message)
    process.exitCode = 1
  }
  await db.end()
}
