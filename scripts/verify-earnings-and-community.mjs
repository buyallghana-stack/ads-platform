/**
 * The 2026-08-12 batch, driven through the real screens.
 *
 *   1. THE EARNINGS BREAKDOWN, both businesses, and every figure in CEDIS.
 *      The operator's rule: no points and no pesewas anywhere on either page.
 *   2. IT ADDS UP. The sources sum to what the page calls the total, which is
 *      the only property that makes the page worth having: a breakdown that
 *      disagrees with the balance on Home teaches people not to trust either.
 *   3. THE COMMUNITY FEATURE, end to end. An admin adds one, a user sees the
 *      NAME (never the url), and the anchor carries rel="noopener".
 *   4. THE DENSITY COMPLAINTS, measured rather than eyeballed: the team
 *      summary and one person row, and the gift code card.
 *
 *   node --env-file=.env.local scripts/verify-earnings-and-community.mjs
 *
 * Needs a server on BASE — `npm run build && npx next start -p 3100`.
 * ⚠️ `pkill -f "next start"` does not kill it; take the pid from `ss -ltnp`.
 * It writes one community row and deletes it in the `finally`.
 */
import { chromium } from '@playwright/test'
import { Client } from 'pg'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const BASE = process.env.BASE ?? 'http://localhost:3100'
const EMAIL = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const PASSWORD = process.env.SHOOT_PASSWORD ?? '1234'

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const stamp = Date.now().toString(36).toUpperCase()
const COMMUNITY = `Verify ${stamp} WhatsApp group`
const body = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const cedis = (text) => [...text.matchAll(/GHS\s?([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, '')))

let browser = null

try {
  await db.connect()

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && /Minified React error|hydrat/i.test(m.text())) errors.push(m.text())
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })

  /* ---- 1 and 2. the two breakdowns ------------------------------------ */
  for (const [name, path, total] of [
    ['ads', '/earnings', 'Earned in total'],
    ['affiliate', '/commission/breakdown', 'Earned in total'],
  ]) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    check(`${name}: the page loads`, res?.status() === 200, `HTTP ${res?.status()}`)

    const text = await body(page)
    /* The label is uppercased in CSS, so innerText comes back shouting. */
    check(`${name}: it says what the total is`, text.toLowerCase().includes(total.toLowerCase()))

    const bad = text.match(/\b\d[\d,]*\s*(pts|points|pesewas?)\b/i)
    check(`${name}: no points or pesewas anywhere`, bad === null, bad?.[0])

    /* The sources add up to the headline. Read off the SCREEN rather than
       recomputed from the database, because agreeing with itself is the
       property under test. */
    /* ONLY THE GROUP ROWS. Ads and Referrals each carry their own breakdown
       underneath them, so summing every figure in the section counts those
       twice — which is a bug in this check, not on the page, and it read as a
       failure the first time. Each group is one `li`, and its own total is the
       last figure in that `li`'s FIRST child. */
    const parts = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find((h) =>
        /where it came from/i.test(h.textContent ?? ''),
      )
      const section = heading?.closest('section')
      if (!section) return []
      return [...section.querySelectorAll(':scope > ul > li')].map((li) => {
        const row = li.firstElementChild
        const spans = row ? [...row.querySelectorAll('span')] : []
        const text = spans.at(-1)?.textContent ?? ''
        const match = text.match(/([\d,]+\.\d{2})/)
        return match ? Number(match[1].replace(/,/g, '')) : 0
      })
    })
    const headline = cedis(text)[0] ?? 0
    const summed = parts.reduce((a, b) => a + b, 0)
    check(
      `${name}: the parts sum to the total`,
      Math.abs(summed - headline) < 0.005,
      `${summed.toFixed(2)} against ${headline.toFixed(2)}`,
    )

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    check(`${name}: no sideways scroll at 390px`, overflow <= 0, `${overflow}px`)
  }

  /* ---- 3. the community feature --------------------------------------- */
  await page.goto(`${BASE}/admin/communities`, { waitUntil: 'networkidle' })
  check('the admin has a Communities screen', (await body(page)).includes('Communities'))

  await page.getByRole('button', { name: /new community/i }).click()
  await page.getByPlaceholder('SidePerks WhatsApp group').fill(COMMUNITY)
  await page.getByPlaceholder('https://chat.whatsapp.com/...').fill(`https://chat.whatsapp.com/${stamp}`)
  await page.getByRole('button', { name: /^save$/i }).click()
  await page.waitForLoadState('networkidle')

  let listed = ''
  for (let i = 0; i < 20 && !listed.includes(COMMUNITY); i += 1) {
    await page.waitForTimeout(400)
    listed = await body(page)
  }
  check('a community can be created', listed.includes(COMMUNITY))

  /* An http link is refused, and the operator is told why rather than being
     handed a constraint name. */
  const { rows: refused } = await db.query(
    `select public.admin_save_community(
       (select user_id from public.user_roles where role = 'super_admin' limit 1),
       null, 'Insecure', 'other', 'http://example.com', 'both', true, 0) is not null as ok`,
  ).then(() => ({ rows: [{ ok: true }] })).catch((e) => ({ rows: [{ ok: false, message: e.message }] }))
  check(
    'an http link is refused with a sentence',
    refused[0].ok === false && /start with https/i.test(refused[0].message ?? ''),
    refused[0].message,
  )

  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const profile = await body(page)
  check('the user sees the community name', profile.includes(COMMUNITY))
  check(
    'and never the url',
    !profile.includes('chat.whatsapp.com'),
    'the name is the whole interface',
  )

  const anchor = page.locator(`a:has-text("${COMMUNITY}")`).first()
  const rel = await anchor.getAttribute('rel')
  const target = await anchor.getAttribute('target')
  check(
    'the link opens safely',
    (rel ?? '').includes('noopener') && (rel ?? '').includes('noreferrer') && target === '_blank',
    `rel="${rel}" target="${target}"`,
  )

  /* ---- 4. the density complaints, measured ---------------------------- */
  await page.goto(`${BASE}/team`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const density = await page.evaluate(() => {
    const grid = document.querySelector('[class*="grid-cols-2"][class*="rounded"]')
    const row = document.querySelector('ol > li')
    return {
      summary: grid ? Math.round(grid.getBoundingClientRect().height) : null,
      row: row ? Math.round(row.getBoundingClientRect().height) : null,
    }
  })
  /* MEASURED BEFORE THE CHANGE: about 300px of stat tiles, and about 170px
     per person. The thresholds are "roughly half of what it was", which is
     what the operator was asking for; they are not design targets, they are
     there to catch a regression back towards the old layout. */
  check('the team summary is compact', (density.summary ?? 999) < 180, `${density.summary}px`)
  check('a person row is compact', (density.row ?? 999) < 120, `${density.row}px`)

  await page.goto(`${BASE}/gift-code`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const card = await page.evaluate(() => {
    const el = document.querySelector('[class*="rounded"][class*="border"]')
    return el ? Math.round(el.getBoundingClientRect().height) : null
  })
  check('the gift code form is contained', (card ?? 999) < 400, `${card}px`)

  check('no page or hydration errors', errors.length === 0, errors.join(' | '))
} catch (error) {
  check('the run completed', false, error.message)
} finally {
  if (browser) await browser.close()
  try {
    await db.query(`delete from public.communities where name like 'Verify %'`)
    const { rows } = await db.query(
      `select count(*)::int as left from public.communities where name like 'Verify %'`,
    )
    console.log(`cleanup: ${rows[0].left} left behind`)
    if (rows[0].left !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message)
    process.exitCode = 1
  }
  await db.end()

  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length}`)
  if (passed !== results.length) process.exitCode = 1
}
