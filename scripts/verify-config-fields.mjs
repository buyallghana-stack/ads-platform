/**
 * The settings screen renders a HAND-WRITTEN field list, not every row in
 * `app_config` — so a config row nobody adds a field for is a setting nobody
 * can reach. That is exactly what happened to the games switch.
 *
 * This checks the seven keys added on 2026-07-30 are on the screen AND that a
 * save round-trips to the database, then puts the value back.
 */
import { chromium } from '@playwright/test'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const KEYS = [
  'games_enabled',
  'game_plays_combine_mode',
  'game_min_seconds_between_plays',
  'leaderboard_visible_ranks',
  'leaderboard_counts_granted_points',
  'leaderboard_shows_zero_earners',
  'gift_code_max_attempts_per_hour',
]

let browser = null
let restore = null
await db.connect()

try {
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

  check('the games group is titled', /games/i.test(body), 'Games heading present')
  check(
    'the lottery warning is shown beside the switch',
    /licens/i.test(body),
    'licensing warning present',
  )

  // ---- A save must actually reach the database ---------------------------
  const { rows: before } = await db.query(
    `select value from public.app_config where key = 'leaderboard_visible_ranks'`,
  )
  restore = before[0].value
  const next = String(Number(restore) === 100 ? 101 : 100)

  const input = page.locator('input[type="number"]').filter({ hasNot: page.locator('x') }).nth(0)
  void input
  // Target by the field's own label rather than by position.
  const ranksInput = page.getByLabel(/places shown on the leaderboard/i)
  await ranksInput.fill(next)
  await page.getByRole('button', { name: /save/i }).first().click()
  await page.waitForTimeout(2500)

  const { rows: after } = await db.query(
    `select value from public.app_config where key = 'leaderboard_visible_ranks'`,
  )
  check('saving writes the new value to the database', after[0].value === next, `${restore} -> ${after[0].value}`)

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
      await db.query(`update public.app_config set value = $1 where key = 'leaderboard_visible_ranks'`, [restore])
      const { rows } = await db.query(
        `select value from public.app_config where key = 'leaderboard_visible_ranks'`,
      )
      console.log(`restored leaderboard_visible_ranks = ${rows[0].value}`)
      if (rows[0].value !== restore) process.exitCode = 1
    }
  } catch (e) {
    console.error('RESTORE FAILED —', e.message)
    process.exitCode = 1
  }
  await db.end()
}
