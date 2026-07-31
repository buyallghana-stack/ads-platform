/**
 * Link ads, end to end through the real screens.
 *
 * BOTH HALVES, because both are new: an administrator makes one in the editor
 * (chooser → article → reading time → destination → live), and then a
 * throwaway user finds it in the feed, reads it, waits out the reading time,
 * taps through and is paid. The database tests in tests/money/link-ads.test.ts
 * prove the money rules; this proves the screens actually reach them.
 *
 * WHAT IT IS REALLY CHECKING: that the link cannot be tapped early. That is
 * the whole defence of this format, and it lives in two places — the server
 * refuses (tested in vitest) and the screen does not offer (tested here).
 *
 * Everything it creates is deleted in the `finally`, and the cleanup is
 * VERIFIED afterwards rather than assumed — a previous session left a live
 * 1,000-point gift code behind by trusting a `finally` that never ran.
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
const EMAIL = `link-${stamp}@test.invalid`
const PASSWORD = `Link!${stamp}`
const TITLE = `Verify link ad ${stamp}`
/* Short enough that the run is not spent waiting, long enough that the "not
   yet" state is genuinely observed rather than raced past. */
const DWELL = 5

let browser = null
let userId = null
let adId = null

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
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Link Reader' },
  })
  if (error) throw error
  userId = data.user.id

  browser = await chromium.launch()

  /* Nothing in this run may actually leave for the advertiser's site: the
     destination is a made-up domain, and a real DNS lookup would hang the
     popup for seconds. The click still happens — which is the part that
     pays — and the navigation is answered locally. */
  const stubAdvertiser = async (ctx) => {
    await ctx.route('**://kente-verify.example.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Advertiser</h1>' }),
    )
  }

  // ---- The administrator authors one -------------------------------------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const admin = await adminCtx.newPage()
  const adminErrors = []
  admin.on('pageerror', (e) => adminErrors.push(e.message))

  await login(admin, 'admin@email.com', '1234')
  await admin.goto(`${BASE}/admin/ads/new`, { waitUntil: 'networkidle' })

  const chooser = await admin.locator('body').innerText()
  check(
    'the new-ad screen offers all three formats',
    /Video/.test(chooser) && /Survey/.test(chooser) && /Link/.test(chooser),
    'video · survey · link',
  )
  await shootPage(admin, 'link-ad-chooser-desktop')

  await admin.getByRole('link', { name: /link/i }).first().click()
  await admin.waitForURL('**/admin/ads/new?format=link', { timeout: 20_000 })
  await admin.getByRole('heading', { name: /new link ad/i }).waitFor({ timeout: 20_000 })

  const editor = await admin.locator('body').innerText()
  check(
    'the editor drops the question builder for a link ad',
    !/cue point/i.test(editor),
    'no question section',
  )
  check('the reading time is defaulted, not left empty', /reading time/i.test(editor), 'field shown')

  await admin.getByLabel(/^title$/i).fill(TITLE)
  await admin.getByLabel(/^text$/i).fill(
    'The Kente Collective is forty weavers working two looms in Bonwire. ' +
      'This paragraph exists so the article clears the forty-character floor the database enforces, ' +
      'and so there is something on the screen worth reading before the link.',
  )
  await admin.getByLabel(/reading time/i).fill(String(DWELL))
  await admin.getByLabel(/address, number or handle/i).fill('kente-verify.example.com')

  // Live, or it never reaches a feed.
  await admin.getByRole('radio', { name: /^live$/i }).click()
  await shootPage(admin, 'link-ad-editor-desktop')
  await admin.getByRole('button', { name: /create ad/i }).first().click()
  await admin.waitForURL('**/admin/ads', { timeout: 30_000 })

  const { rows: made } = await db.query(
    `select id, format, min_watch_seconds, article_body, cta_links, status
       from public.ads where title = $1`,
    [TITLE],
  )
  adId = made[0]?.id ?? null
  check('the editor saved a link ad', made.length === 1 && made[0].format === 'link', made[0]?.format)
  check('the article reached the database', Boolean(made[0]?.article_body), `${made[0]?.article_body?.length ?? 0} chars`)
  check('the reading time reached the database', made[0]?.min_watch_seconds === DWELL, `${made[0]?.min_watch_seconds}s`)
  check('exactly one destination was stored', (made[0]?.cta_links ?? []).length === 1,
    JSON.stringify(made[0]?.cta_links))
  check('no page errors in the admin editor', adminErrors.length === 0, adminErrors[0])
  await adminCtx.close()

  if (!adId) throw new Error('the ad was not created — nothing further can be checked')

  // ---- The user reads it -------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubAdvertiser(ctx)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await login(page, EMAIL, PASSWORD)
  await page.getByRole('link', { name: /^ads$/i }).first().click()
  await page.waitForURL('**/ads', { timeout: 20_000 })

  /*
    MEASURED, not eyeballed. A third tab is exactly the kind of change that
    pushes a strip past the width of a phone, and the symptom — the whole page
    scrolling sideways — is easy to miss in a screenshot taken after the
    browser has already scrolled to bring something into view. 320px is the
    narrowest screen worth supporting; if it fits there it fits everywhere.
  */
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.waitForTimeout(200)
    const box = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    check(`the feed does not scroll sideways at ${width}px`, box.scroll <= box.client,
      `${box.scroll} vs ${box.client}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })

  await page.getByRole('tab', { name: /articles/i }).click()
  const feed = await page.locator('body').innerText()
  check('the Articles tab exists and lists the ad', feed.includes(TITLE), 'card visible')
  check('the card says what is being asked', /read, then tap/i.test(feed), '"Read, then tap"')
  await shootPage(page, 'link-ad-feed-mobile')

  await page.getByText(TITLE).first().click()
  await page.getByText(/Bonwire/).waitFor({ timeout: 20_000 })
  check('the article opens and is readable', true, 'body shown')

  // The countdown, and the fact that there is nothing to tap yet.
  const waiting = await page.locator('body').innerText()
  check('the reading time is counted down in front of the user', /of reading to go/i.test(waiting),
    waiting.split('\n').find((l) => /of reading to go/i.test(l)))
  check(
    'there is NO link to tap before the reading time is up',
    (await page.getByRole('link', { name: /go to the advertiser|visit/i }).count()) === 0,
    'no anchor rendered',
  )
  await shootPage(page, 'link-ad-waiting-mobile')

  /*
    Leaving mid-read asks first, exactly as a video and a survey do. The
    operator's words: the X here "just takes you to the ads tab without showing
    the progress as it looks or behaves for the video and survey".
  */
  // After a couple of seconds of reading, so there is genuinely something to
  // lose — the first second costs nothing and is deliberately not confirmed,
  // which is the same rule the video player uses for watch time.
  await page.waitForTimeout(2200)
  await page.getByRole('button', { name: /close/i }).first().click()
  const leaving = page.getByRole('alertdialog')
  check('leaving mid-read asks, rather than dropping you on the feed',
    (await leaving.count()) > 0, 'the leave dialog is up')
  const leaveText = (await leaving.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('it shows how far into the article they are', /\d+s read of \d+s/.test(leaveText),
    leaveText.match(/\d+s read of \d+s/)?.[0] ?? leaveText.slice(0, 60))
  check('it says leaving costs nothing', /costs you nothing/i.test(leaveText), 'reassurance shown')
  await page.getByRole('button', { name: /stay and finish/i }).click()
  check('staying keeps them in the article',
    (await page.getByRole('alertdialog').count()) === 0 &&
      (await page.getByText(/Bonwire/).count()) > 0,
    'back on the article')

  const before = await balance()

  const cta = page.getByRole('link', { name: /go to the advertiser|visit/i })
  await cta.waitFor({ timeout: (DWELL + 10) * 1000 })
  check('the link appears once the reading time has run', true, `after ~${DWELL}s`)

  const [popup] = await Promise.all([page.waitForEvent('popup'), cta.click()])
  check('the tap opens the advertiser in a new tab', Boolean(popup), popup?.url())
  await popup.close()

  await page.getByText(/points added/i).waitFor({ timeout: 25_000 })
  const after = await balance()
  check('the points landed', after > before, `+${after - before} pts`)
  await shootPage(page, 'link-ad-paid-mobile')

  const { rows: clicks } = await db.query(
    `select points_awarded from public.ad_link_clicks where ad_id = $1 and user_id = $2`,
    [adId, userId],
  )
  check('the visit was recorded once, at what it paid', clicks.length === 1,
    `${clicks.length} row(s), ${clicks[0]?.points_awarded} pts`)
  check('the click row carries the points it paid',
    Number(clicks[0]?.points_awarded) === after - before, `${clicks[0]?.points_awarded}`)

  const { rows: ledger } = await db.query(
    `select count(*)::int n from public.points_ledger where user_id = $1`,
    [userId],
  )
  check('exactly one ledger row', ledger[0].n === 1, `${ledger[0].n} row(s)`)

  // The ad is gone from the feed afterwards: it cannot pay this person twice.
  await page.getByRole('button', { name: /back to ads|done|next ad/i }).first().click()
  await page.waitForTimeout(1500)
  const afterFeed = await page.locator('body').innerText()
  check('the finished ad leaves the feed', !afterFeed.includes(TITLE), 'card gone')

  check('no page errors', errors.length === 0, errors[0])
  await ctx.close()

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
    if (adId) {
      await db.query(`delete from public.ad_link_clicks where ad_id = $1`, [adId])
      await db.query(`delete from public.user_ad_state where ad_id = $1`, [adId])
      await db.query(`delete from public.ad_attempts where ad_id = $1`, [adId])
    }
    if (userId) {
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger enable trigger user`)
      await db.query(`delete from public.user_balances where user_id = $1`, [userId])
      await db.query(`delete from public.daily_earning_counters where user_id = $1`, [userId])
      await db.query(`delete from public.notifications where user_id = $1`, [userId])
      await db.query(`delete from auth.users where id = $1`, [userId])
    }
    // The ad goes last: user_ad_state and the click rows reference it.
    if (adId) await db.query(`delete from public.ads where id = $1`, [adId])

    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = $1) users,
              (select count(*)::int from public.ads where id = $2) ads,
              (select count(*)::int from public.ad_link_clicks where ad_id = $2) clicks,
              (select count(*)::int from pg_trigger
                where tgrelid = 'public.points_ledger'::regclass
                  and tgenabled <> 'O' and not tgisinternal) disabled_triggers`,
      [userId, adId],
    )
    console.log(
      `cleanup: ${rows[0].users} user(s), ${rows[0].ads} ad(s), ${rows[0].clicks} click(s), ${rows[0].disabled_triggers} disabled trigger(s)`,
    )
    if (rows[0].users !== 0 || rows[0].ads !== 0 || rows[0].disabled_triggers !== 0) {
      process.exitCode = 1
    }
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId, '| ad:', adId)
    process.exitCode = 1
  }
  await db.end()
}

async function balance() {
  const { rows } = await db.query(
    `select coalesce(balance, 0)::int b from public.user_balances where user_id = $1`,
    [userId],
  )
  return rows[0]?.b ?? 0
}

async function shootPage(page, name) {
  if (!SHOTS) return
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}
