/**
 * The end of an ad: the three ways out, and whether they actually work.
 *
 * WHY THIS EXISTS. The operator reported that "sometimes after watching the ad
 * and clicking on a button, whether next ad or done, the button becomes
 * unresponsive — especially with the last ads". Three separate faults were
 * behind it, all in the seam between the result card and everything under it,
 * and none of them is visible in a screenshot:
 *
 *   1. The close button was DEAD. The header and the result card's backdrop
 *      were both z-20, and a tie is broken by document order, so the backdrop
 *      won. Escape worked; the tap did not, and a phone has no Escape.
 *   2. On the LAST ad the dismiss button read "Next ad" — there being no next
 *      ad is exactly when that label appeared — and it returned to the feed.
 *   3. Reaching the end of the film after being credited brought the result
 *      card back over the bar at the bottom, taking the tap of anybody
 *      reaching for "Next ad" or "Done" at that moment.
 *
 * Geometry alone would have passed all three: every button was on screen, the
 * right size, and not clipped. So this script taps by COORDINATE with
 * page.mouse — no actionability checks, exactly what a finger does — and
 * asserts what happened afterwards.
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
const EMAIL = `endings-${stamp}@test.invalid`
const PASSWORD = `Endings!${stamp}`
let userId = null
let browser = null

await db.connect()

/** Every enabled control in the overlay, with what is really on top of it. */
const controls = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]')
    if (!root) return null
    return [...root.querySelectorAll('button, a')]
      .filter((el) => el.getBoundingClientRect().width > 0 && !el.disabled)
      .map((el) => {
        const r = el.getBoundingClientRect()
        const x = Math.round(r.x + r.width / 2)
        const y = Math.round(r.y + r.height / 2)
        const top = document.elementFromPoint(x, y)
        return {
          text: (el.textContent || '').trim().slice(0, 22) || '(icon)',
          label: el.getAttribute('aria-label'),
          x,
          y,
          reachable: top === el || el.contains(top),
          blockedBy:
            top === el || el.contains(top)
              ? null
              : `${top?.tagName}.${(top?.className || '').toString().slice(0, 48)}`,
        }
      })
  })

const overlay = async (page) => ({
  open: (await page.locator('[role="dialog"]').count()) > 0,
  label: await page.locator('[role="dialog"]').getAttribute('aria-label').catch(() => null),
})

/** A real tap at a point. No actionability check — that is the whole point. */
const tap = async (page, control) => {
  await page.mouse.move(control.x, control.y)
  await page.mouse.down()
  await page.waitForTimeout(60)
  await page.mouse.up()
  await page.waitForTimeout(1600)
}

const login = async (page) => {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

/** Answer whatever is on screen until the server has ruled. */
const finishAd = async (page) => {
  for (let step = 0; step < 25; step++) {
    const list = await controls(page)
    if (!list) return false
    if (list.some((c) => /^(next ad|done|back to ads|watch again|try again)$/i.test(c.text))) return true
    const play = list.find((c) => /tap to play/i.test(c.text))
    if (play) {
      await page.mouse.click(play.x, play.y)
      await page.waitForTimeout(1500)
      continue
    }
    const option = list.find(
      (c) => !/^(next|submit|back|continue watching|\(icon\))$/i.test(c.text),
    )
    if (option) await page.mouse.click(option.x, option.y)
    const input = page.locator('[role="dialog"] input:not([type="password"])')
    if ((await input.count()) && !(await input.first().inputValue())) {
      await input.first().fill('anything at all')
    }
    await page.waitForTimeout(200)
    const after = await controls(page)
    const submit = after?.find((c) => /^(next|submit|continue watching)$/i.test(c.text))
    if (submit) await page.mouse.click(submit.x, submit.y)
    await page.waitForTimeout(1200)
  }
  return false
}

try {
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Endings Tester' },
  })
  if (error) throw error
  userId = data.user.id

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await login(page)
  await page.goto(`${BASE}/ads`, { waitUntil: 'networkidle' })

  // ---- 1. The close button, on a graded result --------------------------
  await page.getByRole('tab', { name: /surveys/i }).click()
  await page.waitForTimeout(600)
  const surveys = await page.locator('[role="tabpanel"] li button').count()
  check('the feed has surveys to work with', surveys > 0, `${surveys} on the tab`)

  await page.locator('[role="tabpanel"] li button').first().click()
  await page.waitForTimeout(900)
  check('an ad can be finished', await finishAd(page), 'reached a result card')

  const onResult = await controls(page)
  const closer = onResult.find((c) => /close/i.test(c.label ?? ''))
  check('the close button is not painted under the result card', Boolean(closer?.reachable),
    closer?.reachable ? 'on top' : `blocked by ${closer?.blockedBy}`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/endings-result-card.png` })

  await tap(page, closer)
  check('tapping it leaves the ad', !(await overlay(page)).open, 'overlay closed')

  // ---- 2. The last ad says what it does ---------------------------------
  // Straight to the end of the tab: every ad but one is marked done, so the
  // next one opened IS the last one.
  // The one left has to be one they have NOT already done in step 1 — picking
  // "the oldest" blindly can leave zero, which fails for the wrong reason.
  await db.query(
    `with target as (
       select a.id
         from public.ads a
        where a.status = 'active' and a.format = 'survey'
          and not exists (select 1 from public.user_ad_state s
                           where s.user_id = $1 and s.ad_id = a.id and s.status = 'completed')
        order by a.created_at
        limit 1
     )
     insert into public.user_ad_state (user_id, ad_id, status, completed_at)
     select $1, a.id, 'completed', now()
       from public.ads a
      where a.status = 'active' and a.format = 'survey'
        and a.id is distinct from (select id from target)
     on conflict (user_id, ad_id) do update set status = 'completed'`,
    [userId],
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: /surveys/i }).click()
  await page.waitForTimeout(600)
  const left = await page.locator('[role="tabpanel"] li button').count()
  check('one survey is left', left === 1, `${left} card(s)`)

  await page.locator('[role="tabpanel"] li button').first().click()
  await page.waitForTimeout(900)
  await finishAd(page)
  const lastControls = await controls(page)
  const labels = lastControls.map((c) => c.text)
  check(
    'the last ad does not offer a "Next ad" that goes nowhere',
    !labels.some((l) => /^next ad$/i.test(l)),
    labels.join(' | '),
  )
  const wayOut = lastControls.find((c) => /^(back to ads|done)$/i.test(c.text))
  check('it offers a way back instead', Boolean(wayOut), wayOut?.text)
  await tap(page, wayOut)
  check('and that way back works', !(await overlay(page)).open, 'overlay closed')

  // ---- 3. The film running out must not steal the tap -------------------
  await page.reload({ waitUntil: 'networkidle' })
  const video = page.locator('[role="tabpanel"] li button', { hasText: /Gold Coast Water/ }).first()
  if ((await video.count()) === 0) {
    check('the watch-only video is in the feed', false, 'not offered — skipped the film check')
  } else {
    await video.click()
    await page.waitForTimeout(1200)
    const play = (await controls(page)).find((c) => /tap to play/i.test(c.text))
    if (play) await page.mouse.click(play.x, play.y)
    await page.getByText(/points added/i).waitFor({ timeout: 60_000 })

    const keep = (await controls(page)).find((c) => /keep watching/i.test(c.text))
    check('a film with time left offers to keep playing', Boolean(keep), keep?.text ?? 'not offered')
    if (keep) {
      await tap(page, keep)
      const bar = (await controls(page)).filter((c) => /^(next ad|done)$/i.test(c.text))
      check('the bar under the film carries the ways on', bar.length > 0, bar.map((b) => b.text).join(' | '))

      // Let the film run out underneath it.
      await page.waitForTimeout(6000)

      /* The check below is only worth anything if the film GENUINELY ended —
         otherwise it passes without ever exercising the thing that broke. */
      const film = await page.evaluate(() => {
        const v = document.querySelector('[role="dialog"] video')
        return v ? { ended: v.ended, at: Math.round(v.currentTime), of: Math.round(v.duration) } : null
      })
      check('the film really did run out', film?.ended === true, film ? `${film.at}s of ${film.of}s` : 'no video element')

      const after = (await controls(page)).filter((c) => /^(next ad|done)$/i.test(c.text))
      check(
        'the film ending does not replace the bar with the result card',
        after.length > 0 && after.every((c) => c.reachable),
        after.length ? after.map((c) => `${c.text}${c.reachable ? '' : ' BLOCKED'}`).join(' | ') : 'the bar is gone',
      )
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/endings-after-film.png` })

      const done = after.find((c) => /^done$/i.test(c.text))
      if (done) {
        await tap(page, done)
        check('Done still works once the film has finished', !(await overlay(page)).open, 'overlay closed')
      }
    }
  }

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
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
      await db.query(`alter table public.points_ledger enable trigger user`)
      for (const table of [
        'user_balances',
        'daily_earning_counters',
        'ad_attempts',
        'user_ad_state',
        'notifications',
      ]) {
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
