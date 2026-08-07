/**
 * Setting what the affiliate games and tasks pay, through the real screen.
 *
 * Everything built on 2026-08-07 shipped inert: five tasks paying GHS 0.00 and
 * a prize table of amounts I invented, with no way to change either short of
 * SQL. This run proves the screen that fixes that actually writes:
 *
 *   1. A PRIZE AMOUNT TYPED IN CEDIS LANDS IN PESEWAS. The single most likely
 *      bug on this screen, and the most expensive: a factor of 100 on a prize
 *      table is the difference between GHS 25 and GHS 2,500 per spin.
 *   2. THE ODDS AND THE AVERAGE COST ARE RECOMPUTED AS YOU TYPE, because an
 *      operator cannot do that arithmetic in their head and the number they
 *      would guess is always too low.
 *   3. A TASK REWARD SAVES, and the affiliate side sees it.
 *   4. THE RETROACTIVE WARNING IS HONEST. Tasks pay everybody who already
 *      meets the target, so the screen has to say how many that is BEFORE the
 *      save, not after.
 *   5. A TASK SOMEBODY HAS BEEN PAID FOR IS ARCHIVED, NEVER DELETED.
 *
 * It restores every figure it touched in the `finally` and re-reads them: this
 * runs against the shared project, where a prize table left changed is a live
 * prize table left changed.
 *
 *   node --env-file=.env.local scripts/verify-affiliate-rewards.mjs
 *
 * Needs a server on BASE — `npm run build && npx next start -p 3100`.
 */
import { chromium } from '@playwright/test'
import { Client } from 'pg'

/* ⚠️ Never let a closed stdout kill this run — see verify-commission-admin. */
process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? ''
const ADMIN_EMAIL = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const ADMIN_PASSWORD = process.env.SHOOT_PASSWORD ?? '1234'

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
let browser = null
/** Every prize row as it was, restored whatever happens. */
let originalPrizes = []
let createdTaskId = null

const body = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

await db.connect()

try {
  const { rows: before } = await db.query(
    `select id, slot, label, amount_minor, extra_plays, weight, is_active
       from public.affiliate_game_prizes where game = 'mystery_box' order by slot`,
  )
  originalPrizes = before
  if (!before.length) throw new Error('no mystery box prizes to edit')
  console.log(`prizes before: ${before.map((p) => `${p.slot}=${p.amount_minor}`).join(', ')}\n`)

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/admin/, { timeout: 30_000 })

  /* ---- 1. the way in ---------------------------------------------------- */
  await page.goto(`${BASE}/admin/affiliates`, { waitUntil: 'networkidle' })
  const door = page.locator('a[href$="/admin/affiliates/rewards"]')
  check('the affiliates queue carries the way in to Rewards', (await door.count()) > 0, 'link present')

  const response = await page.goto(`${BASE}/admin/affiliates/rewards`, { waitUntil: 'networkidle' })
  check('/admin/affiliates/rewards loads', response?.status() === 200, `HTTP ${response?.status()}`)

  const opening = await body(page)
  check(
    'it says whether the games are live before anything is tuned',
    /switched off|are OPEN/i.test(opening),
    opening.match(/The games are (switched off|OPEN)/i)?.[0] ?? 'not stated',
  )

  /* ---- 2. the arithmetic on screen -------------------------------------- */
  const amountCells = page.locator('table input[inputmode="decimal"]')
  check('the prize table renders its rows', (await amountCells.count()) >= 4, `${await amountCells.count()} rows`)

  const averageBefore = (await body(page)).match(/Average cost of a play GHS ([\d,.]+)/i)?.[1]

  /* GHS 12.34 into the first slot: not a round number, so a factor-of-100 slip
     cannot hide in it. */
  await amountCells.first().fill('12.34')
  await page.waitForTimeout(400)
  const afterTyping = await body(page)
  const averageAfter = afterTyping.match(/Average cost of a play GHS ([\d,.]+)/i)?.[1]
  check(
    'the average cost of a play moves as the table is edited',
    Boolean(averageAfter) && averageAfter !== averageBefore,
    `${averageBefore} to ${averageAfter}`,
  )
  check(
    'and the odds column is shown per row',
    /%/.test(afterTyping) && /Odds/i.test(afterTyping),
    'odds present',
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/affiliate-rewards.png`, fullPage: true })

  /* ---- 3. saving writes pesewas, not cedis ------------------------------ */
  await page.getByRole('button', { name: /^Save$/i }).first().click()
  await page.waitForTimeout(2_500)

  const { rows: saved } = await db.query(
    `select amount_minor from public.affiliate_game_prizes
      where game = 'mystery_box' and slot = $1`,
    [before[0].slot],
  )
  check(
    'GHS 12.34 typed on the screen is 1234 pesewas in the database',
    Number(saved[0].amount_minor) === 1234,
    `${saved[0].amount_minor} minor`,
  )

  /* ---- 4. a task reward, and the retroactive warning --------------------- */
  await page.getByRole('button', { name: /Tasks/i }).first().click()
  await page.waitForTimeout(600)

  await page.getByRole('button', { name: /New task/i }).click()
  await page.waitForTimeout(400)

  const name = `Verify task ${stamp}`
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Reward (GHS)').fill('7.50')
  await page.waitForTimeout(200)

  const warning = await body(page)
  check(
    'the form warns that tasks are retroactive before anything is saved',
    /retroactive/i.test(warning),
    'warning shown',
  )

  await page.getByRole('button', { name: /Check who qualifies/i }).click()
  await page.waitForTimeout(1_500)
  const answered = await body(page)
  check(
    'and answers how many could claim it immediately',
    /could claim this immediately/i.test(answered),
    answered.match(/\d+ affiliates could claim this immediately[^.]*\./i)?.[0] ?? 'no answer',
  )

  await page.getByRole('button', { name: /^Save$/i }).first().click()
  await page.waitForTimeout(2_500)

  const { rows: task } = await db.query(
    `select id, reward_minor, metric, target, is_active
       from public.affiliate_tasks where name = $1`,
    [name],
  )
  check('the task is created', task.length === 1, `${task.length} row(s)`)
  createdTaskId = task[0]?.id ?? null
  check(
    'GHS 7.50 is 750 pesewas in the database',
    Number(task[0]?.reward_minor) === 750,
    `${task[0]?.reward_minor} minor`,
  )

  /* ---- 5. the affiliate side sees it ------------------------------------ */
  const { rows: affiliate } = await db.query(
    `select a.user_id from public.affiliate_accounts a limit 1`,
  )
  if (affiliate.length) {
    const { rows: seen } = await db.query(`select public.get_affiliate_tasks($1) as j`, [
      affiliate[0].user_id,
    ])
    const mine = (seen[0].j ?? []).find((t) => t.name === name)
    check(
      'and an affiliate sees it with the reward on it',
      Boolean(mine) && Number(mine.reward_minor) === 750,
      mine ? `${mine.reward_minor} minor` : 'not visible',
    )
  }

  /* ---- 6. a claimed task is archived, never deleted --------------------- */
  await db.query(
    `insert into public.affiliate_task_completions (task_id, user_id, progress_at_claim, reward_minor)
     values ($1, $2, 1, 750)`,
    [createdTaskId, affiliate[0].user_id],
  )

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Tasks/i }).first().click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: new RegExp(`Remove ${name}`, 'i') }).click()
  await page.waitForTimeout(2_500)

  const { rows: afterDelete } = await db.query(
    `select is_active from public.affiliate_tasks where id = $1`,
    [createdTaskId],
  )
  check(
    'a task somebody has been paid for is switched off, not deleted',
    afterDelete.length === 1 && afterDelete[0].is_active === false,
    afterDelete.length ? `is_active ${afterDelete[0].is_active}` : 'row is GONE',
  )
  check(
    'and the screen says which happened',
    /switched off rather than deleted/i.test(await body(page)),
    'explained',
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
    for (const p of originalPrizes) {
      await db.query(
        `update public.affiliate_game_prizes
            set amount_minor = $2, extra_plays = $3, weight = $4, is_active = $5, label = $6
          where id = $1`,
        [p.id, p.amount_minor, p.extra_plays, p.weight, p.is_active, p.label],
      )
    }
    const { rows: back } = await db.query(
      `select slot, amount_minor from public.affiliate_game_prizes
        where game = 'mystery_box' order by slot`,
    )
    console.log(`prizes after:  ${back.map((p) => `${p.slot}=${p.amount_minor}`).join(', ')}`)
    const restored = originalPrizes.every(
      (p) => String(back.find((b) => b.slot === p.slot)?.amount_minor) === String(p.amount_minor),
    )
    if (!restored) {
      console.error('PRIZE TABLE NOT RESTORED — a live prize table is still changed')
      process.exitCode = 1
    }

    if (createdTaskId) {
      await db.query(`delete from public.affiliate_task_completions where task_id = $1`, [
        createdTaskId,
      ])
      await db.query(`delete from public.affiliate_tasks where id = $1`, [createdTaskId])
    }
    const { rows: left } = await db.query(
      `select count(*)::int n from public.affiliate_tasks where name like 'Verify task %'`,
    )
    console.log(`cleanup: ${left[0].n} fixture task(s) left`)
    if (left[0].n !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| task:', createdTaskId)
    process.exitCode = 1
  }
  await db.end()
}
