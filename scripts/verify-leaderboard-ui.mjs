/**
 * Drives the leaderboard the way a person would, on a board with enough
 * people on it to be worth looking at.
 *
 * The dev database has four live profiles, so the podium would otherwise be
 * two people and a gap. This creates a cast of throwaway users with credits
 * placed at chosen moments — some last week, some this — so that the periods
 * differ from each other and the movement arrows have something to report.
 *
 * EVERYTHING IS PURGED IN THE `finally`, including the ledger rows, which
 * needs the documented trigger-disable recipe because `points_ledger` refuses
 * DELETE to every role. The count of what is left behind is printed, and a
 * non-zero count fails the run — a fixture that survives on this database is
 * a fake user on the operator's real leaderboard.
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
/* Real-looking Ghanaian names, because the whole point of the display-name
   rule is that "Kwame Asante" becomes "Kwame A." and a name like "Test User3"
   would not show whether that works. */
const CAST = [
  { name: 'Ama Boateng', last: 6_000, now: 9_000 },
  { name: 'Kwame Asante', last: 9_000, now: 7_500 },
  { name: 'Yaw Osei', last: 2_000, now: 5_200 },
  { name: 'Efua Mensah', last: 4_000, now: 3_100 },
  { name: 'Kojo Owusu', last: 0, now: 2_400 },
  { name: 'Abena Darko', last: 1_000, now: 1_200 },
  { name: 'Kofi Antwi', last: 800, now: 900 },
]

let browser = null
const made = []

await db.connect()

const login = async (page, email, password) => {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/(dashboard|admin)(\/|$|\?)/, { timeout: 30_000 })
}

/**
 * Waits for the BOARD, not for the network.
 *
 * `waitForLoadState('networkidle')` fires while `(app)/loading.tsx` is still
 * on screen — the page streams, so the skeleton is a fully loaded document.
 * The first run of this script asserted against that skeleton and reported a
 * missing crown and missing names on a screen that was working perfectly.
 * The tab strip only exists in the real page, so it is the honest signal.
 */
const boardReady = async (page) => {
  const started = Date.now()
  await page.getByRole('tablist').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('ol li').first().waitFor({ state: 'visible', timeout: 30_000 })
  return Date.now() - started
}

const shoot = async (page, name) => {
  if (!SHOTS) return
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}

try {
  // ---- A cast with a past and a present ----------------------------------
  for (const person of CAST) {
    const { data, error } = await sb.auth.admin.createUser({
      email: `lb-${stamp}-${person.name.split(' ')[0].toLowerCase()}@test.invalid`,
      password: `Lb!${stamp}`,
      email_confirm: true,
      user_metadata: { full_name: person.name },
    })
    if (error) throw error
    made.push({ id: data.user.id, ...person })

    // Placed by hand rather than through credit_points, which stamps now():
    // the periods and the arrows are the subject here.
    if (person.last > 0) {
      await db.query(
        `insert into public.points_ledger
           (user_id, entry_type, amount, balance_after, points_per_currency_unit, created_at)
         values ($1, 'ad_view', $2, $2, public.config_int('points_per_currency_unit'),
                 date_trunc('week', now()) - interval '3 days')`,
        [data.user.id, person.last],
      )
    }
    await db.query(
      `insert into public.points_ledger
         (user_id, entry_type, amount, balance_after, points_per_currency_unit, created_at)
       values ($1, 'ad_view', $2, $2, public.config_int('points_per_currency_unit'),
               greatest(date_trunc('week', now()), now() - interval '2 hours'))`,
      [data.user.id, person.now],
    )
  }
  console.log(`seeded ${made.length} people`)

  browser = await chromium.launch()

  // ---- The user's board ---------------------------------------------------
  const userCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const user = await userCtx.newPage()
  const userErrors = []
  user.on('pageerror', (e) => userErrors.push(e.message))
  /* Signed in as one of the cast, NOT as the demo admin: `landingFor` sends
     an admin straight to /admin, where the shortcut row does not exist, so
     the first run of this script failed looking for a link on a page the
     admin never sees. Kofi is last of the seven, which is what makes the
     scroll in "My rank" a real scroll rather than a no-op. */
  await login(user, `lb-${stamp}-kofi@test.invalid`, `Lb!${stamp}`)

  // Reached from the shortcut row, not by typing a URL.
  await user.getByRole('link', { name: /leaderboard/i }).first().click()
  await user.waitForURL('**/leaderboard', { timeout: 20_000 })
  const painted = await boardReady(user)
  check('the leaderboard shortcut opens the screen', true, `${user.url()} in ${painted}ms`)

  const body = await user.locator('body').innerText()
  check(
    'names are abbreviated to a first name and an initial',
    body.includes('Kwame A.') && !body.includes('Asante'),
    body.includes('Asante') ? 'a surname leaked onto the page' : 'Kwame A.',
  )

  const crown = await user.locator('svg.lucide-crown').count()
  check('the winner wears the crown', crown === 1, `${crown} crown(s)`)

  await shoot(user, 'leaderboard-week-mobile')

  // Movement: Ama was 2nd last week and is 1st this week, so she must be up;
  // Kwame was 1st and is now 2nd, so he must be down.
  const amaRow = user.locator('li', { hasText: 'Ama B.' }).first()
  const kwameRow = user.locator('li', { hasText: 'Kwame A.' }).first()
  const amaUp = await amaRow.locator('svg.lucide-trending-up').count()
  const kwameDown = await kwameRow.locator('svg.lucide-trending-down').count()
  check('the climber shows an up arrow', amaUp > 0, `${amaUp} up arrow(s) on Ama B.`)
  check('the faller shows a down arrow', kwameDown > 0, `${kwameDown} down arrow(s) on Kwame A.`)

  // Periods really differ: All time includes last week's credits, Today does
  // not include either.
  const weekText = await user.locator('body').innerText()
  await user.getByRole('tab', { name: /all time/i }).click()
  await user.locator('[role="tab"][aria-selected="true"]').filter({ hasText: /all time/i }).waitFor()
  const allText = await user.locator('body').innerText()
  check('switching period changes the board', weekText !== allText, 'week and all-time differ')
  await shoot(user, 'leaderboard-alltime-mobile')

  await user.getByRole('tab', { name: /today/i }).click()
  await user.waitForTimeout(300)
  check(
    'today is a different board again',
    (await user.locator('body').innerText()) !== allText,
    'today differs from all-time',
  )

  // ---- My rank ------------------------------------------------------------
  await user.getByRole('tab', { name: /all time/i }).click()
  await user.waitForTimeout(300)
  const myRank = user.getByRole('button', { name: /my rank/i })
  check('the my-rank button is offered', await myRank.isVisible(), 'visible')
  await myRank.click()
  await user.waitForTimeout(900)
  const mine = user.locator('[data-me="true"]')
  const mineCount = await mine.count()
  check(
    'the user has exactly one row of their own',
    mineCount === 1,
    `${mineCount} row(s) marked as me`,
  )
  if (mineCount === 1) {
    const box = await mine.boundingBox()
    const inView = box !== null && box.y >= 0 && box.y <= 844
    check('my rank scrolled the row into view', inView, box ? `y=${Math.round(box.y)}` : 'no box')
  }
  await shoot(user, 'leaderboard-myrank-mobile')

  check('no page errors on the user board', userErrors.length === 0, userErrors[0])
  await userCtx.close()

  // ---- Somebody on the podium ---------------------------------------------
  // The top three are podium tiles, not list rows. Before this was checked,
  // "My rank" found nothing at all for exactly the people most likely to
  // press it.
  const topCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const top = await topCtx.newPage()
  await login(top, `lb-${stamp}-ama@test.invalid`, `Lb!${stamp}`)
  await top.goto(`${BASE}/leaderboard`)
  await boardReady(top)
  const podiumMe = await top.locator('[data-me="true"]').count()
  check('a podium finisher is marked as themselves', podiumMe === 1, `${podiumMe} marked`)
  await topCtx.close()

  // ---- The admin's copy ---------------------------------------------------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const admin = await adminCtx.newPage()
  const adminErrors = []
  admin.on('pageerror', (e) => adminErrors.push(e.message))
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD)
  await admin.goto(`${BASE}/admin/leaderboard?period=week`, { waitUntil: 'networkidle' })

  const adminBody = await admin.locator('body').innerText()
  check(
    'the admin sees the full name, email and phone',
    adminBody.includes('Kwame Asante') && adminBody.includes('@test.invalid'),
    'full name + email present',
  )
  check(
    'the admin also sees what users are shown',
    adminBody.includes('Kwame A.'),
    'abbreviated name present too',
  )
  await shoot(admin, 'leaderboard-admin-desktop')

  check('no page errors on the admin board', adminErrors.length === 0, adminErrors[0])
  await adminCtx.close()

  /* ---- The breakpoint sweep ---------------------------------------------
     Done here rather than in shoot-app.mjs because this is the only moment
     the board has enough people on it to be worth photographing — the cast is
     purged in the `finally`. Overflow is asserted rather than eyeballed: a
     board is a wide row of numbers and the phone is where it breaks. */
  if (SHOTS) {
    const VIEWPORTS = [
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 834, height: 1112 },
      { name: 'desktop', width: 1440, height: 900 },
    ]
    for (const theme of ['light', 'dark']) {
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: theme,
          reducedMotion: 'reduce',
        })
        const page = await ctx.newPage()
        const errs = []
        page.on('pageerror', (e) => errs.push(e.message))
        await login(page, `lb-${stamp}-kofi@test.invalid`, `Lb!${stamp}`)
        await page.goto(`${BASE}/leaderboard`)
        await boardReady(page)
        await page.waitForTimeout(400)
        await page.screenshot({ path: `${SHOTS}/board-${theme}-${vp.name}.png`, fullPage: true })

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        check(
          `no sideways scroll at ${vp.width} (${theme})`,
          overflow <= 0 && errs.length === 0,
          `overflow ${overflow}px${errs.length ? `, ${errs[0]}` : ''}`,
        )
        await ctx.close()
      }
    }

    // And the admin table at its two shapes, which switch at lg.
    for (const vp of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'dark' })
      const page = await ctx.newPage()
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      await page.goto(`${BASE}/admin/leaderboard?period=week`, { waitUntil: 'networkidle' })
      await page.screenshot({ path: `${SHOTS}/admin-dark-${vp.name}.png`, fullPage: true })
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      check(`admin board does not scroll sideways at ${vp.width}`, overflow <= 0, `overflow ${overflow}px`)
      await ctx.close()
    }
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
    const ids = made.map((m) => m.id)
    if (ids.length) {
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = any($1::uuid[])`, [ids])
      await db.query(`alter table public.points_ledger enable trigger user`)
      await db.query(`delete from public.user_balances where user_id = any($1::uuid[])`, [ids])
      await db.query(`delete from public.notifications where user_id = any($1::uuid[])`, [ids])
      await db.query(`delete from auth.users where id = any($1::uuid[])`, [ids])
    }

    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = any($1::uuid[])) users,
              (select count(*)::int from public.points_ledger where user_id = any($1::uuid[])) ledger,
              (select count(*)::int from public.profiles where full_name like 'Test %') strays`,
      [ids],
    )
    console.log(`cleanup: ${rows[0].users} user(s), ${rows[0].ledger} ledger row(s) left behind`)
    if (rows[0].users !== 0 || rows[0].ledger !== 0) process.exitCode = 1

    // The three ledger triggers must be back on, whatever happened above.
    const { rows: trg } = await db.query(
      `select count(*)::int n from pg_trigger
        where tgrelid = 'public.points_ledger'::regclass and tgenabled <> 'O' and not tgisinternal`,
    )
    console.log(`ledger triggers disabled after run: ${trg[0].n}`)
    if (trg[0].n !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| ids:', made.map((m) => m.id).join(','))
    process.exitCode = 1
  }
  await db.end()
}
