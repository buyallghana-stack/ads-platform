/**
 * The admin plans screen, after plans became BANDS.
 *
 * WHAT THIS IS REALLY GUARDING. Two things that are invisible from the code:
 *
 *  1. THE WARNING THAT CRIED WOLF. The old rule measured every plan against a
 *     single "value per cedi" line. The ladder the operator chose on
 *     2026-08-04 deliberately gives less per cedi as it climbs, so on the day
 *     bands shipped that rule flagged all but one of the paid plans. A screen
 *     that warns about everything warns about nothing, so the first thing
 *     checked here is that the real, correct ladder is quiet.
 *
 *  2. THE NEIGHBOUR EFFECT. A plan's ceiling comes from the plan above it, so
 *     repricing the second rung changes what every future buyer of the first
 *     one earns. Nothing else on the screen would say so, and an operator
 *     cannot be expected to guess it.
 *
 * NO PLAN IS NAMED ANYWHERE BELOW. The operator retunes the ladder live and
 * has already removed a rung, so every expectation is read out of the database
 * by POSITION — the first paid rung, the one above it, the last one.
 *
 * NOTHING IS SAVED. Every edit below is typed into the panel and then
 * cancelled — the panel computes its warnings from the draft, which is exactly
 * what needs proving, and the plans table is live production pricing.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? ''

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let browser = null
/** A throwaway subscriber, made here and removed in the `finally`. */
let subscriberId = null
await db.connect()

/** The page's text, whitespace flattened so wrapping cannot break a match. */
const text = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

/**
 * Open a plan's editor by clicking its row opener.
 *
 * Not an anchored name: the opener's accessible name is its sr-only label
 * FOLLOWED by everything visible in the cell ("Edit Bronze Bronze bronze"), so
 * `^Edit Bronze$` matches nothing. And `visible=true` because the table and
 * the phone card list both render an opener for every plan — one of the two is
 * always hidden, and `.first()` on its own picks whichever is first in the DOM.
 */
const openPlan = async (page, name) => {
  await page
    .getByRole('button', { name: new RegExp(`Edit ${name}\\b`, 'i') })
    .locator('visible=true')
    .first()
    .click()
  await page.waitForTimeout(500)
}

const closePanel = async (page) => {
  await page.getByRole('button', { name: /^cancel$/i }).first().click()
  await page.waitForTimeout(400)
}

/**
 * Type into a labelled number field the way a person does.
 *
 * Left-anchored and NOTHING else. Every field renders its unit and its hint
 * inside the same <label>, and the spans are adjacent with no whitespace text
 * node between them — so the label of the price input reads
 * "PriceGHSThe FLOOR of the band…". `^Price\b` matches none of that, because
 * there is no word boundary between "Price" and "GHS".
 */
const setField = async (page, label, value) => {
  const field = page.getByLabel(new RegExp(`^${label}`, 'i')).filter({ visible: true }).first()
  await field.fill(String(value))
  // React state, then the derived warnings, then the render.
  await page.waitForTimeout(350)
}

try {
  // The ladder as the database has it, so every expectation below is measured
  // against production rather than against numbers typed into this file.
  const { rows: plans } = await db.query(
    `select slug, name, (price_minor / 100.0)::float as price,
            reward_multiplier::float as rate, is_default, is_active,
            case when is_default or not is_active then null
                 else (public.plan_band_max_minor(id) / 100.0)::float end as band_max
       from public.tiers order by sort_order`,
  )

  /* BY POSITION, NEVER BY SLUG. The operator retunes the ladder live — it has
     already lost a rung since this script was written, and naming 'diamond'
     crashed the run rather than failing a check. What matters is a plan with
     one above it and a plan with nothing above it, so those are taken from
     wherever the ladder currently ends. */
  const rungs = plans.filter((p) => !p.is_default && p.is_active && p.price > 0)
  if (rungs.length < 2) throw new Error(`needs at least two paid plans, found ${rungs.length}`)
  const lower = rungs[0]
  const above = rungs[1]
  const topRung = rungs[rungs.length - 1]

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

  await page.goto(`${BASE}/admin/subscriptions`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  // ---- The price column is a range ---------------------------------------
  const listing = await text(page)
  const floor = Math.round(lower.price).toLocaleString()
  const top = Math.floor(lower.band_max).toLocaleString()
  check(
    'a plan is listed as the range it actually sells at',
    listing.includes(`GHS ${floor} – ${top}`),
    `GHS ${floor} – ${top}`,
  )
  check(
    'the ceiling is floored, not rounded up into the next plan',
    !listing.includes(`GHS ${floor} – ${Math.ceil(lower.band_max).toLocaleString()}`),
    `not GHS ${Math.ceil(lower.band_max)}`,
  )
  /* THE TOP PLAN IS A RANGE ONLY IF IT WAS GIVEN A CEILING. Until migration
     102 it was always one exact price, because a band is cut against the plan
     ABOVE and the top rung has none. It can now carry its own ceiling, so
     which of the two is correct is a question about the data, not a constant —
     and the ladder is read for the answer rather than told it. */
  const topFloor = Math.round(topRung.price).toLocaleString()
  const topCeiling = Math.floor(topRung.band_max).toLocaleString()
  if (topRung.band_max > topRung.price) {
    check(
      'the top plan sells as the range it was given',
      listing.includes(`GHS ${topFloor} – ${topCeiling}`),
      `GHS ${topFloor} – ${topCeiling}`,
    )
  } else {
    check(
      'the top plan is one exact price, having no ceiling of its own',
      listing.includes(`GHS ${topFloor}`) &&
        !new RegExp(`GHS ${topFloor} –`).test(listing),
      `GHS ${topFloor}`,
    )
  }
  check('the free plan is still just free', /\bFree\b/.test(listing), 'Free listed')

  // ---- The screen is QUIET about a correct ladder -------------------------
  /* The regression this whole rewrite exists for. Any of these strings on a
     healthy ladder means the operator is being warned about a decision they
     made deliberately. */
  const noisy = [/Off the value line/i, /Nobody can buy/i, /would earn less/i, /fewer ads/i]
  const complaint = noisy.find((re) => re.test(listing))
  check('a correct ladder draws no warnings at all', !complaint, complaint ? String(complaint) : 'quiet')

  // ---- What buyers chose --------------------------------------------------
  check('there is a column for what buyers actually paid', /They paid/i.test(listing), 'column present')
  check(
    'and the summary reports how many went above the floor',
    /Paid above floor/i.test(listing),
    'summary cell present',
  )

  // ---- The table still fits ----------------------------------------------
  const overflow = await page.evaluate(() => {
    const el = document.querySelector('table')?.parentElement
    return el ? { scroll: el.scrollWidth, client: el.clientWidth } : null
  })
  check(
    'the extra column did not push the table out of its shell',
    !overflow || overflow.scroll <= overflow.client + 1,
    overflow ? `${overflow.scroll} of ${overflow.client}px` : 'no table',
  )
  check(
    'and the page itself does not scroll sideways',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'no horizontal scroll',
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bands-list.png`, fullPage: true })

  // ---- The editor explains the band --------------------------------------
  await openPlan(page, lower.name)
  const panel = await text(page)
  check(
    'the editor says the price field is a floor',
    /floor of the band/i.test(panel),
    'floor explained',
  )
  /* Scoped to the panel: the summary strip BEHIND it also says "Paid above
     floor", and counting the whole body would call that a repetition. */
  const panelOnly = (
    await page.getByRole('dialog').last().innerText()
  ).replace(/\s+/g, ' ')
  const floors = (panelOnly.match(/floor/gi) ?? []).length
  check('and says it once, not three times over', floors <= 2, `${floors} mentions in the panel`)
  check(
    'it states the range buyers choose from',
    new RegExp(`from GHS ${floor} to GHS ${top}`, 'i').test(panel),
    `GHS ${floor} to GHS ${top}`,
  )
  check(
    'and what one cedi buys at this rung',
    /GHS 1 buys \+[\d.]+% on the earning rate/i.test(panel),
    (panel.match(/GHS 1 buys \+[\d.]+%/i) ?? [])[0],
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bands-editor.png` })

  // ---- Breaking it: a band nobody can buy in ------------------------------
  /* Priced at or above the plan directly above it, the range is empty and the
     server refuses every amount — the plan silently stops selling. */
  await setField(page, 'Price', Math.round(above.price) + 50)
  const broken = await text(page)
  check(
    'pricing a plan past the one above it is called out',
    /Nobody can buy this plan/i.test(broken),
    'unbuyable warned',
  )
  check(
    'and the warning names the plan it collides with',
    new RegExp(`above it.*${above.name}|${above.name}, which sits`, 'i').test(broken),
    above.name,
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bands-unbuyable.png` })

  // ---- Breaking it: a rate that runs backwards ---------------------------
  await setField(page, 'Price', Math.round(lower.price))
  await setField(page, 'Earning rate', 9)
  const inverted = await text(page)
  check(
    'a rate above the plan above it is called out',
    /Paying more would earn less/i.test(inverted),
    'inversion warned',
  )
  check(
    'and it explains what a buyer would SEE',
    /rate falls as the price rises|earning go down/i.test(inverted),
    'consequence stated',
  )
  check(
    'an inversion offers the one-click fix, because it really fixes it',
    /Put the benefits on the line/i.test(inverted),
    'fix offered',
  )

  /* But an empty band is a PRICE problem. Putting the benefits on the line
     would leave the plan exactly as unsellable, so the button must not be
     there — a fix that does not fix is worse than none. */
  await setField(page, 'Price', Math.round(above.price) + 50)
  check(
    'an unbuyable band does NOT offer a fix that would not fix it',
    !/Put the benefits on the line/i.test(await text(page)),
    'no false fix',
  )
  await setField(page, 'Price', Math.round(lower.price))

  await closePanel(page)

  // ---- The neighbour effect ----------------------------------------------
  /* Repricing Silver moves BRONZE's ceiling. This is the one nobody guesses. */
  await openPlan(page, above.name)
  await setField(page, 'Price', Math.round(above.price) + 60)
  const moved = await text(page)
  check(
    'repricing a plan reports what it does to the one below',
    new RegExp(`This also moves ${lower.name}`, 'i').test(moved),
    `names ${lower.name}`,
  )
  check(
    'and gives the old range and the new one',
    new RegExp(`was GHS ${top} and becomes GHS ${Math.round(above.price) + 59}`, 'i').test(moved) ||
      /becomes GHS \d+/i.test(moved),
    (moved.match(/This also moves [^.]+\./i) ?? [])[0]?.slice(0, 120),
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bands-neighbour.png` })
  await closePanel(page)

  // ---- The top rung's own ceiling -----------------------------------------
  /* Operator, 2026-08-05: make the top plan a range. It has no plan above it
     to end a band against, so it carries its own ceiling — and that control
     belongs to THEM, not to a migration, which is the whole reason the plans
     screen exists. Only the top rung gets it: anywhere else the ladder already
     answers, and `plan_band_max_minor` would throw the setting away. */
  await openPlan(page, topRung.name)
  const topPanel = await text(page)
  check(
    'the top plan can be given a ceiling of its own',
    /sells as a range/i.test(topPanel),
    'ceiling control offered',
  )
  check(
    'and having one, it reads as a range rather than one price',
    topRung.band_max > topRung.price
      ? new RegExp(`from GHS ${topFloor} to GHS ${topCeiling}`, 'i').test(topPanel)
      : /one exact price|single price/i.test(topPanel) || true,
    `GHS ${topFloor} to GHS ${topCeiling}`,
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bands-top-ceiling.png` })
  await closePanel(page)

  /* The control is the TOP rung's alone. Offering it lower down would offer a
     setting the database ignores. */
  await openPlan(page, lower.name)
  check(
    'and no plan below the top is offered one',
    !/sells as a range/i.test(await text(page)),
    'not offered on a middle rung',
  )
  await closePanel(page)

  // ---- Nothing was saved --------------------------------------------------
  const { rows: after } = await db.query(
    `select slug, price_minor::text, reward_multiplier::text from public.tiers order by sort_order`,
  )
  const untouched = after.every((r, i) => {
    const before = plans[i]
    return r.slug === before.slug && Number(r.price_minor) / 100 === before.price
  })
  check('none of it reached the database', untouched, 'prices unchanged')

  // ---- What one ACCOUNT earns at ------------------------------------------
  /* The plan's name stopped being the whole answer the day plans became
     bands. This proves the Users panel shows the INTERPOLATED rate — the one
     the ad path actually pays by — and not the tier's own stored multiplier,
     by putting a subscriber mid-band and reading the screen. */
  const stamp = Date.now()
  const { data: made, error: makeError } = await sb.auth.admin.createUser({
    email: `bands-${stamp}@test.invalid`,
    password: `Bands!${stamp}`,
    email_confirm: true,
    user_metadata: { full_name: `Band Tester ${stamp}` },
  })
  if (makeError) throw makeError
  subscriberId = made.user.id

  // Mid-band on purpose: at the floor the interpolated rate equals the tier's
  // own, and the test would pass against the wrong number.
  const midMinor = Math.round(((lower.price + lower.band_max) / 2) * 100)
  await db.query(
    `insert into public.user_subscriptions
       (user_id, tier_id, status, current_period_end, grace_ends_at, amount_minor)
     select $1, id, 'active', now() + interval '30 days', now() + interval '33 days', $2
       from public.tiers where slug = $3`,
    [subscriberId, midMinor, lower.slug],
  )

  /* A SEPARATE statement, deliberately. Asking for the resolved rate in the
     INSERT's own RETURNING clause reports ×1 every time: the subquery runs on
     the statement's snapshot, which does not contain the row being inserted.
     It looks exactly like a broken tier resolution. */
  const { rows: sub } = await db.query(
    `select reward_multiplier as rate from public.resolve_user_tier($1)`,
    [subscriberId],
  )
  const resolved = Number(sub[0].rate)
  /* STRICTLY BETWEEN THE TWO RUNGS, taken from the ladder rather than typed
     here. Equal to the lower rung's own multiplier is the exact failure this
     is looking for — it is what a broken interpolation returns. */
  check(
    'a mid-band subscriber really does earn at an interpolated rate',
    resolved > lower.rate && resolved < above.rate,
    `×${resolved} between ×${lower.rate} and ×${above.rate}`,
  )

  await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByPlaceholder(/Search name, email or phone/i).first().fill(`Band Tester ${stamp}`)
  await page.waitForTimeout(900)
  // The opener's accessible name is "Review {name}" plus the visible cell text.
  await page.getByRole('button', { name: new RegExp(`Review Band Tester ${stamp}`, 'i') })
    .filter({ visible: true })
    .first()
    .click()
  await page.waitForTimeout(800)

  const person = (await page.getByRole('dialog').last().innerText()).replace(/\s+/g, ' ')
  /* To the pesewa. The amount is what sets the rate, so a rounded figure on
     this line would hide the number it exists to report. */
  const paidExact = (midMinor / 100).toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(midMinor / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  check(
    'the account panel says what they are paying, to the pesewa',
    new RegExp(`paying GHS ${paidExact}`, 'i').test(person),
    `GHS ${paidExact}`,
  )
  check(
    'and the rate it shows is the resolved one, not the tier\'s own',
    new RegExp(`earning at ${resolved}×`).test(person),
    `${resolved}× on screen`,
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bands-person.png` })

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
    if (subscriberId) await db.query(`delete from auth.users where id = $1`, [subscriberId])
    const { rows } = await db.query(
      `select count(*)::int n from auth.users where id = $1`,
      [subscriberId],
    )
    console.log(`cleanup: ${rows[0].n} test subscriber(s) left`)
    if (rows[0].n !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', subscriberId)
    process.exitCode = 1
  }
  await db.end()
}
