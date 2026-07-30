/**
 * Drives both games through the real UI.
 *
 * ⚠️ THIS SCRIPT TURNS `games_enabled` ON, and the dev database is the same
 * Supabase project production uses. The window is seconds, the switch is
 * restored in the `finally` whatever happens, and the restore is VERIFIED
 * before the run is allowed to pass — a run that leaves the games live would
 * be worse than a run that fails.
 *
 * The throwaway player is granted Platinum so there are five plays to spend
 * without waiting a week, and is purged with the documented trigger-disable
 * recipe because winning points writes to the append-only ledger.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? ''
const ADMIN_EMAIL = 'admin@email.com'
const ADMIN_PASSWORD = '1234'

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
const EMAIL = `games-${stamp}@test.invalid`
const PASSWORD = `Games!${stamp}`

let browser = null
let userId = null
let switchedOn = false
let originalGap = '3'

await db.connect()

const login = async (page, email, password) => {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/(dashboard|admin)(\/|$|\?)/, { timeout: 30_000 })
}

const shoot = async (page, name) => {
  if (!SHOTS) return
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}

try {
  // ---- A player with plays to spend ---------------------------------------
  const { data: made, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Game Tester' },
  })
  if (error) throw error
  userId = made.user.id

  await db.query(
    `insert into public.user_subscriptions (user_id, tier_id, status, started_at, current_period_end)
     select $1, id, 'active', now() - interval '1 day', now() + interval '30 days'
       from public.tiers where slug = 'platinum'`,
    [userId],
  )

  // ---- With the switch OFF the games must not exist ------------------------
  browser = await chromium.launch()
  const offCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const offPage = await offCtx.newPage()
  await login(offPage, EMAIL, PASSWORD)
  await offPage.goto(`${BASE}/games`)
  await offPage.waitForTimeout(1200)
  /*
    Asserted on what RENDERS, not on the status code. `(app)/loading.tsx`
    makes this route stream, so the shell — and the 200 — are flushed before
    `notFound()` runs; Next cannot retract a status it has already sent. The
    page really does render the 404 and no game, which is what matters, but a
    status assertion here fails against working code.
  */
  const offBody = await offPage.locator('body').innerText()
  const offLinks = await offPage.getByRole('link', { name: /mystery box|wheel/i }).count()
  check(
    'the games are unreachable while the switch is off',
    /404|could not be found/i.test(offBody) && offLinks === 0,
    `${offLinks} game link(s), body: ${offBody.replace(/\s+/g, ' ').slice(0, 60)}`,
  )
  const tileDisabled = await offPage
    .getByRole('link', { name: /games/i })
    .count()
    .catch(() => 0)
  check('the Home tile is not a link while off', tileDisabled === 0, `${tileDisabled} link(s)`)
  await offCtx.close()

  // ---- Switch on ----------------------------------------------------------
  const { rows: before } = await db.query(
    `select value from public.app_config where key = 'game_min_seconds_between_plays'`,
  )
  originalGap = before[0]?.value ?? '3'
  await db.query(`update public.app_config set value = 'true' where key = 'games_enabled'`)
  await db.query(
    `update public.app_config set value = '0' where key = 'game_min_seconds_between_plays'`,
  )
  switchedOn = true
  console.log('games_enabled -> true (restored in finally)')

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await login(page, EMAIL, PASSWORD)

  // Reached from the shortcut row, which should now be live.
  await page.getByRole('link', { name: /games/i }).first().click()
  await page.waitForURL('**/games', { timeout: 20_000 })
  await page.getByRole('heading', { name: /games|jeux/i }).first().waitFor({ timeout: 20_000 })
  check('the Games tile opens the hub once enabled', true, page.url())
  await shoot(page, 'games-hub-mobile')

  const hubText = await page.locator('body').innerText()
  check('the hub states the shared allowance', /5 plays left/i.test(hubText), hubText.split('\n').find((l) => /plays left/i.test(l)) ?? 'not found')

  // ---- Mystery box --------------------------------------------------------
  await page.getByRole('link', { name: /mystery box/i }).click()
  await page.waitForURL('**/games/mystery-box', { timeout: 20_000 })
  const boxes = await page.getByRole('button', { name: /^Box \d+$/ }).count()
  check('twelve boxes are offered', boxes === 12, `${boxes} boxes`)
  await shoot(page, 'games-box-mobile')

  const balanceBefore = await db
    .query(`select coalesce(balance,0)::int b from public.user_balances where user_id = $1`, [userId])
    .then((r) => r.rows[0]?.b ?? 0)

  await page.getByRole('button', { name: 'Box 5' }).click()
  await page.getByText(/you won/i).waitFor({ timeout: 25_000 })
  const wonText = await page.locator('body').innerText()
  check('picking a box reveals a prize', /you won/i.test(wonText), wonText.split('\n').slice(0, 6).join(' / '))
  await shoot(page, 'games-box-won-mobile')

  const { rows: played } = await db.query(
    `select points_awarded, slot from public.game_plays where user_id = $1 order by created_at desc limit 1`,
    [userId],
  )
  const balanceAfter = await db
    .query(`select coalesce(balance,0)::int b from public.user_balances where user_id = $1`, [userId])
    .then((r) => r.rows[0]?.b ?? 0)
  check(
    'the points reached the balance',
    balanceAfter - balanceBefore === Number(played[0]?.points_awarded ?? -1),
    `+${balanceAfter - balanceBefore} pts, prize was ${played[0]?.points_awarded}`,
  )

  const { rows: ledger } = await db.query(
    `select count(*)::int n from public.points_ledger
      where user_id = $1 and entry_type = 'game_prize'`,
    [userId],
  )
  check('exactly one ledger credit was written', ledger[0].n === 1, `${ledger[0].n} row(s)`)

  // ---- The wheel, from the same shared pool --------------------------------
  await page.goto(`${BASE}/games/wheel`, { waitUntil: 'networkidle' })
  /* Scoped to the wheel itself. `svg path` counts every lucide icon on the
     page too, which is how this first reported 28 wedges. */
  const wedges = await page.locator('svg[role="img"] path').count()
  check('the wheel has twelve wedges', wedges === 12, `${wedges} paths`)
  await shoot(page, 'games-wheel-mobile')

  await page.getByRole('button', { name: /^spin$/i }).click()
  await page.getByText(/you won/i).waitFor({ timeout: 30_000 })
  check('the wheel spins and pays', true, 'reveal shown')
  await shoot(page, 'games-wheel-won-mobile')

  const { rows: both } = await db.query(
    `select count(*)::int n, count(distinct game)::int games from public.game_plays where user_id = $1`,
    [userId],
  )
  check(
    'both games drew from the one pool',
    both[0].n === 2 && both[0].games === 2,
    `${both[0].n} plays across ${both[0].games} games`,
  )

  // ---- The wheel must stop on the slot the server drew ---------------------
  const { rows: last } = await db.query(
    `select slot from public.game_plays where user_id = $1 and game = 'spin_wheel'
      order by created_at desc limit 1`,
    [userId],
  )
  const { rows: label } = await db.query(
    `select label from public.game_prizes where game = 'spin_wheel' and slot = $1`,
    [last[0].slot],
  )
  const revealText = await page.locator('body').innerText()
  check(
    'the reveal names the prize the database drew',
    revealText.includes(label[0].label),
    `drew "${label[0].label}"`,
  )

  check('no page errors across both games', errors.length === 0, errors[0])
  await ctx.close()

  // ---- The admin prize editor ---------------------------------------------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const admin = await adminCtx.newPage()
  const adminErrors = []
  admin.on('pageerror', (e) => adminErrors.push(e.message))
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD)
  await admin.goto(`${BASE}/admin/games?game=mystery_box`, { waitUntil: 'networkidle' })

  const adminText = await admin.locator('body').innerText()
  check('the editor shows what a play costs', /cost per play/i.test(adminText), 'RTP figure present')
  check('the editor shows plays per plan', /plays per week/i.test(adminText), 'plan panel present')
  const chanceCells = await admin.getByText(/%$/).count()
  check('per-outcome odds are shown', chanceCells >= 12, `${chanceCells} percentages`)
  await shoot(admin, 'games-admin-desktop')
  check('no page errors on the admin editor', adminErrors.length === 0, adminErrors[0])
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
    if (switchedOn) {
      await db.query(`update public.app_config set value = 'false' where key = 'games_enabled'`)
      await db.query(`update public.app_config set value = $1 where key = 'game_min_seconds_between_plays'`, [
        originalGap,
      ])
    }

    if (userId) {
      await db.query(`delete from public.game_plays where user_id = $1`, [userId])
      await db.query(`delete from public.user_subscriptions where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger enable trigger user`)
      await db.query(`delete from public.user_balances where user_id = $1`, [userId])
      await db.query(`delete from public.notifications where user_id = $1`, [userId])
      await db.query(`delete from auth.users where id = $1`, [userId])
    }

    const { rows } = await db.query(
      `select (select value from public.app_config where key = 'games_enabled') as games,
              (select count(*)::int from auth.users where id = $1) as users,
              (select count(*)::int from public.game_plays where user_id = $1) as plays,
              (select count(*)::int from pg_trigger
                where tgrelid = 'public.points_ledger'::regclass
                  and tgenabled <> 'O' and not tgisinternal) as disabled_triggers`,
      [userId],
    )
    const state = rows[0]
    console.log(
      `cleanup: games_enabled=${state.games}, ${state.users} user(s), ${state.plays} play(s), ` +
        `${state.disabled_triggers} disabled trigger(s)`,
    )
    // The switch is the one that matters: leaving it on is a live lottery.
    if (state.games !== 'false' || state.users !== 0 || state.disabled_triggers !== 0) {
      console.error('CLEANUP INCOMPLETE — check the switch and the fixtures')
      process.exitCode = 1
    }
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId)
    process.exitCode = 1
  }
  await db.end()
}
