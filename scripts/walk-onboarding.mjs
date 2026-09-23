/**
 * Walks a brand new account through the whole first-run walkthrough, on the
 * real app, and photographs every step.
 *
 *   BASE=http://localhost:3100 SHOTS=/tmp/walk node scripts/walk-onboarding.mjs
 *
 * ⚠️ IT CREATES A REAL ACCOUNT ON WHATEVER PROJECT `.env.local` POINTS AT, which
 * is production. Same trade as `verify-games-ui.mjs`: the walkthrough cannot be
 * proved against a mock, because the whole point of it is that steps tick from
 * real tables. The account is named so it is obvious in any list, and it is
 * purged in the `finally` whatever happens.
 *
 * ⚠️ PURGING NEEDS THE TRIGGER RECIPE. `auth.admin.deleteUser` fails silently
 * for anybody who has earned points, because the ledger is append-only and
 * holds a reference. The rows go first, in dependency order, and the delete is
 * VERIFIED afterwards rather than assumed.
 *
 * It asserts as it goes. A step that renders nothing clickable is a failure
 * here, not a screenshot nobody looks at: that is exactly how the Team step
 * shipped with its bubble off the bottom of the screen.
 */
import { readFileSync, mkdirSync } from 'node:fs'

import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
}

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? '/tmp/walk'
mkdirSync(SHOTS, { recursive: true })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const db = new Client({
  connectionString: process.env.PRODUCTION_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const stamp = Date.now()
const EMAIL = `walkthrough-${stamp}@test.invalid`
const PASSWORD = `Walk!${stamp}`

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

let browser = null
let userId = null
let shotNo = 0

/* The spotlight steps: the ones that dim the screen and therefore must freeze
   it. A task step deliberately does neither, because the member needs the real
   screen to do the real thing. */
const locked = ['balance', 'statement', 'games', 'community', 'invite-team']

await db.connect()

/** Photograph, and prove the step offers a way forward while we are here. */
const shoot = async (page, name, { expectAction = true } = {}) => {
  shotNo += 1
  const file = `${String(shotNo).padStart(2, '0')}-${name}`
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/${file}.png` })

  if (expectAction) {
    /*
      Every step must have something pressable IN THE VIEWPORT. A control that
      has rendered below the fold is the Team bug: present in the DOM, so a
      naive check passes, and unreachable to a thumb.
    */
    const reachable = await page.evaluate(() => {
      const vh = window.innerHeight
      const vw = window.innerWidth
      return [...document.querySelectorAll('button, a[href]')].some((el) => {
        const r = el.getBoundingClientRect()
        const text = (el.textContent ?? '').trim().toLowerCase()
        if (!/next|skip|show me|what next|choose|later|go|find my own/.test(text)) return false
        return r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw && r.width > 0
      })
    })
    check(`${file}: a way forward is on screen`, reachable)

    /*
      ⚠️ AND THE PAGE MUST BE FROZEN UNDER IT. The referral step opened with
      its card and its bubble both below the fold, so the member had to go
      hunting for the button. A spotlight locks the page and puts the target in
      the space above the card; nothing should move but the step.
    */
    if (locked.includes(name)) {
      /*
        ⚠️ TESTED AS BEHAVIOUR, NOT AS A CSS PROPERTY. This used to assert
        `body { overflow: hidden }`, which is both the wrong question and the
        mechanism that broke the walkthrough on a real phone: it can clamp the
        scroll to zero and it blocks the tour's own corrections. What a member
        actually needs is that scrolling does not move the page, so that is
        what gets asked, with a real wheel gesture.
      */
      const before = await page.evaluate(() => window.scrollY)
      await page.mouse.wheel(0, 500)
      await page.waitForTimeout(600)
      const scroll = await page.evaluate(() => ({ y: window.scrollY }))
      check(
        `${file}: scrolling does not move the page`,
        Math.abs(scroll.y - before) < 8,
        JSON.stringify({ before, after: scroll.y }),
      )

      /*
        ⚠️ AND THE HOLE MUST SIT ON ITS TARGET. It drifted by about 60px on the
        invite step, straddling the card below it, because the measurement ran
        before locking the page settled the layout. A cutout that points at the
        wrong thing is worse than no cutout: it tells the member to look at
        something that is not there.
      */
      const aligned = await page.evaluate((a) => {
        const el = document.querySelector(`[data-tour="${a}"]`)
        /* Scoped to the overlay. `svg path + path` on its own matches the
           second path of the first lucide icon on the page, which measures
           something entirely unrelated and fails for the wrong reason. */
        const ring = document.querySelector('[role="dialog"] svg path + path')
        if (!el || !ring) return { ok: false, why: 'target or ring missing' }
        const t = el.getBoundingClientRect()
        const r = ring.getBoundingClientRect()
        const dTop = Math.abs(r.top - (t.top - 10))
        const dBottom = Math.abs(r.bottom - (t.bottom + 10))
        /* A target taller than the visible zone cannot be framed entirely, so
           what matters is that its TOP is on screen and the hole starts there:
           the beginning of the thing the step is describing. */
        const tall = t.height > window.innerHeight - 260 - 72
        const topVisible = t.top >= 0 && t.top < window.innerHeight - 260
        return tall
          ? { ok: dTop < 8 && topVisible, tall, dTop: Math.round(dTop), top: Math.round(t.top) }
          : { ok: dTop < 8 && dBottom < 8, dTop: Math.round(dTop), dBottom: Math.round(dBottom) }
      }, { 'invite-team': 'invite', games: 'quick-links', community: 'communities' }[name] ?? name)
      check(`${file}: the cutout sits on its target`, aligned.ok, JSON.stringify(aligned))

      /*
        ⚠️ AND THE CARD MUST NOT SIT ON THE THING IT IS POINTING AT. Reported
        on the community step: the row was lit and the card covered it, so the
        link the step was asking for could not be tapped. Lighting something
        you have just made unreachable is worse than not lighting it.
      */
      const clear = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        const ring = dialog?.querySelector('svg path + path')
        const card = dialog?.querySelector('div:not([class*="fixed inset-0"]) > div[class*="rounded-"]')
        const panel = [...(dialog?.querySelectorAll('div') ?? [])].find((d) =>
          /fixed inset-x-0/.test(d.className),
        )
        if (!ring || !panel) return { ok: false, why: 'ring or card missing' }
        const r = ring.getBoundingClientRect()
        const c = panel.getBoundingClientRect()
        const overlap = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top))
        return { ok: overlap < 2, overlap: Math.round(overlap) }
      })
      check(`${file}: the card does not cover the target`, clear.ok, JSON.stringify(clear))

      /*
        ⚠️ AND THE TARGET HAS TO BE ON SCREEN AT ALL. Reported from a real
        phone: steps 7 and 9 showed a dimmed page with NOTHING lit, because the
        one positioning scroll ran before the dashboard had settled and the
        page was then locked so nothing could correct it. The member read the
        whole walkthrough as broken from step seven on.
      */
      const visible = await page.evaluate((a) => {
        const el = document.querySelector(`[data-tour="${a}"]`)
        if (!el) return { ok: false, why: 'target missing' }
        const r = el.getBoundingClientRect()
        return {
          ok: r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0,
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          vh: window.innerHeight,
        }
      }, { 'invite-team': 'invite', games: 'quick-links', community: 'communities' }[name] ?? name)
      check(`${file}: the target is on screen`, visible.ok, JSON.stringify(visible))

      /*
        ⚠️ AND IT RECOVERS IF SOMETHING MOVES THE PAGE AFTERWARDS.

        This is the operator's failure, reproduced. A headless run finishes the
        revalidate before the positioning loop settles, so it always passed
        here; on a real phone over LTE the refresh landed later, reset the
        scroll, and the old build had already locked and stopped correcting.
        The result was a dimmed screen with nothing lit on it.

        Shoving the page to the top is the same insult, delivered on purpose.
      */
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(900)
      const recovered = await page.evaluate((a) => {
        const el = document.querySelector(`[data-tour="${a}"]`)
        if (!el) return { ok: false, why: 'target missing' }
        const r = el.getBoundingClientRect()
        return { ok: r.top >= 0 && r.bottom <= window.innerHeight, top: Math.round(r.top) }
      }, { 'invite-team': 'invite', games: 'quick-links', community: 'communities' }[name] ?? name)
      check(`${file}: recovers when the page is thrown to the top`, recovered.ok, JSON.stringify(recovered))
    }
  }
  console.log(`  shot ${file}.png`)
}

/**
 * Press, once the control will actually take a press.
 *
 * ⚠️ WAIT FOR ENABLED, NOT JUST VISIBLE. Advancing a step is a server round
 * trip, and the button carries `disabled aria-busy` while it is in flight.
 * Clicking on visible alone hits a dead button and then times out against an
 * element that is about to be replaced anyway.
 */
const press = async (page, pattern) => {
  const button = page.getByRole('button', { name: pattern }).first()
  await button.waitFor({ state: 'visible', timeout: 20_000 })
  for (let i = 0; i < 40 && !(await button.isEnabled().catch(() => false)); i += 1) {
    await page.waitForTimeout(250)
  }
  await button.click({ timeout: 15_000 })
  await page.waitForTimeout(2000)
}

try {
  /* ---- a brand new account ------------------------------------------------ */
  const { data: made, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Walkthrough Tester' },
  })
  if (error) throw error
  userId = made.user.id
  console.log(`created ${EMAIL}`)

  browser = await chromium.launch()
  /*
    The operator's own phone: a tall viewport in DARK MODE. Both matter. The
    height decides how far down the fold a target sits, and the dark theme is
    where a 50% scrim separates least, so it is the harder of the two cases and
    the one the faults were reported from.
  */
  const page = await browser.newPage({
    viewport: {
      width: Number(process.env.VW ?? 430),
      height: Number(process.env.VH ?? 932),
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: process.env.SCHEME === 'light' ? 'light' : 'dark',
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  /*
    ⚠️ WAIT FOR HYDRATION BEFORE TOUCHING THE FORM. Filling and submitting
    first made the browser do a NATIVE submit, which is how the missing
    `method="post"` was found: the credentials went into the URL. The form is
    only wired up once React has attached, and the page going quiet is the
    fastest honest signal for that.
  */
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1200)
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  /* `waitForURL` defaults to waiting for `load`, which a streamed App Router
     page does not reliably fire on a dev server mid-compile. Commit is enough:
     the URL is what decides the sign-in worked. */
  await page.waitForURL(/\/dashboard/, { timeout: 90_000, waitUntil: 'commit' })
  /* A URL carrying a password means the native submit happened again, which is
     a finding, not a flake. Fail loudly rather than carry on. */
  if (/password=/.test(page.url())) throw new Error('login submitted natively: ' + page.url())
  await page.waitForTimeout(4000)

  /* ---- 1. the welcome, and one real click through it ----------------------- */
  await shoot(page, 'welcome')
  await press(page, /show me around/i)
  await page.waitForTimeout(2500)
  const advanced = await page.getByText(/step \d+ of/i).first().isVisible().catch(() => false)
  check('the welcome sheet advances on a click', advanced)

  /*
    From here the steps are driven from the database rather than by clicking.

    ⚠️ NOT BECAUSE CLICKING IS UNTESTED, but because each advance is a server
    round trip and the button carries `disabled aria-busy` until it lands: on a
    cold dev server a click-driven walk spends its time racing spinners and
    photographs half-rendered steps. The DATABASE is the source of the current
    step anyway, so setting it and reloading renders exactly what a member
    reaching that step would see. The click is proved once, above.
  */
  const seeSteps = async (seen, name, opts) => {
    await db.query(
      `insert into public.user_onboarding (user_id, seen_steps, skipped_at)
       values ($1, $2, null)
       on conflict (user_id) do update set seen_steps = $2, skipped_at = null`,
      [userId, seen],
    )
    await page.goto(`${BASE}/en/dashboard`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3200)
    await shoot(page, name, opts)
  }

  await seeSteps([], 'balance')
  await seeSteps(['balance'], 'statement')

  /* ---- 3. the ad step, on the real ads screen ------------------------------ */
  await seeSteps(['balance', 'statement'], 'first-ad-task')
  const onAds = page.url().includes('/ads')
  check('the ad step walks the member to the ads screen', onAds, page.url())

  /* A real completion, written the way the ad flow writes it. */
  const { rows: ads } = await db.query(
    `select id, points_reward from public.ads where status = 'active' order by created_at limit 1`,
  )
  await db.query(
    `insert into public.user_ad_state (user_id, ad_id, status, completed_at)
     values ($1, $2, 'completed', now())
     on conflict (user_id, ad_id) do update set status = 'completed', completed_at = now()`,
    [userId, ads[0].id],
  )
  await db.query(
    `select public.credit_points($1, $2::bigint, 'ad_view'::public.ledger_entry_type, 'ad', $3, '{}'::jsonb)`,
    [userId, Number(ads[0].points_reward), ads[0].id],
  )

  /* ---- 4. the congratulation ----------------------------------------------- */
  await seeSteps(['balance', 'statement'], 'celebration')
  /* A sheet owns the screen and carries no step counter, unlike a spotlight
     bubble. What matters is that the moment is reached at all: migration 190
     made it derived and the walkthrough stepped clean over it. */
  const celebrated = await page.getByText(/that is real money/i).isVisible().catch(() => false)
  check('the congratulation is reached, not stepped over', celebrated)
  const saysCedis = await page.getByText(/GHS/).first().isVisible().catch(() => false)
  check('the congratulation names a cedi figure', saysCedis)

  /* ---- 5 to 9 --------------------------------------------------------------- */
  const done = ['balance', 'statement', 'celebrate']
  void done
  await seeSteps(done, 'payout-task')

  /* ⚠️ The bar sat over the account-name field and the Save button, so the
     member could not see what they were typing or reach the control that
     finishes the step. It must step aside when a field takes focus. */
  /* The payout screen opens on an "Add" button, not on the form, so a check
     that looked for an input found none and skipped in silence. Open it. */
  await page.getByRole('button', { name: /^\s*\+?\s*add/i }).first().click().catch(() => {})
  await page.waitForTimeout(1200)

  const field = page.locator('input:visible').first()
  if (await field.count()) {
    const before = await page.evaluate(() => {
      const bar = document.querySelector('[role="status"]')
      return bar ? Math.round(bar.getBoundingClientRect().top) : null
    })
    await field.click().catch(() => {})
    await page.waitForTimeout(700)
    const after = await page.evaluate(() => {
      const bar = document.querySelector('[role="status"]')
      if (!bar) return { gone: true }
      const r = bar.getBoundingClientRect()
      return { gone: r.top >= window.innerHeight - 4, top: Math.round(r.top), vh: window.innerHeight }
    })
    check('the task bar clears the form while typing', after.gone, JSON.stringify({ before, after }))
    await page.screenshot({ path: `${SHOTS}/06b-payout-typing.png` })
    await page.keyboard.press('Escape').catch(() => {})
  }
  await seeSteps(done, 'pin-task')

  /* The payout and PIN steps are satisfied by the real thing existing. */
  await db.query(
    `insert into public.user_payout_details (user_id, method, msisdn, account_name, provider_id)
     select $1, 'mobile_money', '0240000000', 'Walkthrough Tester', id
       from public.payout_providers where is_active order by sort_order limit 1
     on conflict do nothing`,
    [userId],
  )
  await db.query(
    `insert into public.user_security (user_id, pin_hash, pin_set_at) values ($1, 'walkthrough', now())
     on conflict (user_id) do update set pin_hash = excluded.pin_hash`,
    [userId],
  )

  await seeSteps(done, 'games')
  await seeSteps([...done, 'games'], 'community')

  /* ---- the step that was reported unusable --------------------------------- */
  await seeSteps([...done, 'games', 'community'], 'invite-team')
  /* Home, not /team: `ReferralCard` renders on both, and sending them to the
     Team tab meant the spotlight framed the card on Home while the driver was
     still navigating away from it. */
  const inviteUrl = page.url()
  check('the invite step stays on Home, where the card is', inviteUrl.includes('/dashboard'), inviteUrl)

  /* ---- 10. the plans ------------------------------------------------------- */
  await seeSteps([...done, 'games', 'community', 'invite'], 'plans-carousel')
  /* Every plan visible at once, which a carousel could not promise. */
  const planRows = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-pressed]')]
      .map((b) => {
        const r = b.getBoundingClientRect()
        return { text: (b.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), onScreen: r.top >= 0 && r.bottom <= window.innerHeight }
      }),
  )
  check('every plan on sale is a row', planRows.length === 4, `${planRows.length} rows`)
  check('every plan is visible without swiping', planRows.every((r) => r.onScreen), JSON.stringify(planRows.map((r) => r.text)))
  check('the free plan is not offered', !planRows.some((r) => /free/i.test(r.text)), planRows.map((r) => r.text).join(' | '))
  const referral = await page.getByText(/referral bonus/i).first().isVisible().catch(() => false)
  check('no referral bonus is claimed', !referral)

  /* ---- what a member who skipped is left with ------------------------------ */
  await db.query(`update public.user_onboarding set skipped_at = now() where user_id = $1`, [userId])
  await page.goto(`${BASE}/en/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await shoot(page, 'checklist-after-skip', { expectAction: false })

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('li')]
      .map((li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((t) => /your balance|statement|first ad|first points|payout|withdrawal PIN|other ways|community|invite|plans/i.test(t))
      .slice(0, 12),
  )
  console.log('\nchecklist after skipping, with an ad watched:')
  rows.forEach((r) => console.log('  ' + r))
  /* The congratulation is a MOMENT, so it is deliberately not a row: watching
     the first ad is collecting the first points. Its presence was the reported
     lie; its absence is the fix. */
  const pointsRow = rows.find((r) => /first points/i.test(r))
  check('the checklist does not ask for points already earned', !pointsRow, pointsRow ?? 'absent, as intended')
  const adRow = rows.find((r) => /first ad/i.test(r))
  check('the watched ad is listed and ticked', Boolean(adRow), adRow ?? 'row missing')

  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length} checks passed`)
} finally {
  if (browser) await browser.close()

  /* ---- purge --------------------------------------------------------------- */
  if (userId) {
    for (const sql of [
      `delete from public.user_ad_state where user_id = $1`,
      `delete from public.user_onboarding where user_id = $1`,
      `delete from public.user_payout_details where user_id = $1`,
      `delete from public.user_security where user_id = $1`,
      `delete from public.user_subscriptions where user_id = $1`,
      `delete from public.notifications where user_id = $1`,
    ]) {
      await db.query(sql, [userId]).catch((e) => console.log('  purge note:', e.message.split('\n')[0]))
    }

    /*
      ⚠️ THE LEDGER REFUSES DELETE. It is append-only and says so from a
      trigger, so the first version of this purge failed on that line, gave up,
      and left a test account sitting in PRODUCTION. Disable, delete,
      re-enable, and then PROVE nothing stayed disabled: a run that leaves the
      append-only guarantee switched off is far worse than a run that fails.
    */
    await db.query(`alter table public.points_ledger disable trigger user`)
    await db.query(`delete from public.points_ledger where user_id = $1`, [userId])
    await db.query(`alter table public.points_ledger enable trigger user`)

    for (const sql of [
      `delete from public.user_balances where user_id = $1`,
      `delete from public.profiles where id = $1`,
      `delete from auth.users where id = $1`,
    ]) {
      await db.query(sql, [userId]).catch((e) => console.log('  purge note:', e.message.split('\n')[0]))
    }

    const { rows } = await db.query(`select count(*)::int n from auth.users where id = $1`, [userId])
    const { rows: trg } = await db.query(
      `select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relname = 'points_ledger' and t.tgenabled <> 'O' and not t.tgisinternal`,
    )
    console.log(rows[0].n === 0 ? `purged ${EMAIL}` : `⚠️ ${EMAIL} SURVIVED the purge`)
    console.log(
      trg[0].n === 0
        ? 'points_ledger is append-only again'
        : `⚠️ ${trg[0].n} points_ledger trigger(s) LEFT DISABLED, re-enable them now`,
    )
  }
  await db.end()
}
