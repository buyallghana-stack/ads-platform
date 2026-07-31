/**
 * The Team screen, against real committed data, then cleaned up.
 *
 * WHY THROWAWAY ACCOUNTS AND NOT THE DEMO ONES. This has to commit: a browser
 * cannot see an uncommitted transaction, so the vitest harness (one rolled-back
 * transaction per test) cannot render a screen. Committing referrals, plans and
 * payouts onto `user@email.com` or `admin@email.com` would attach a permanent
 * referral chain to accounts the operator uses for real, and `referrals` has a
 * unique referee — there is no undo for "who introduced you". So the whole cast
 * is disposable and is deleted in a `finally`, which is then verified.
 *
 * The cast, which is also the shape the screen has to survive:
 *   TOP    — signed in, sees everybody
 *   L1-A   — bought Platinum + Gold + Bronze, withdrew some, has points left
 *   L1-B   — bought nothing and never gave a phone number
 *   L2-C   — invited by L1-A: level two, one plan, nothing withdrawn
 *
 * L1-B exists to prove a missing phone renders as a word rather than a blank,
 * and L1-A to prove "Platinum + 2" — the operator's rule for somebody holding
 * more than one plan.
 */
import { randomUUID } from 'node:crypto'

import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
/* BIG=1 replaces the fixtures with figures nobody will ever reach — a plan
   bill in the millions and a seven-figure balance — because the question this
   screen has to answer is not "does it fit" but "at what width does it stop
   fitting". Layout only; the assertions on the amounts are skipped. */
const BIG = process.env.BIG === '1'
const OUT = process.env.SHOT_DIR ?? '/tmp/team-shots'
const PASSWORD = 'Sideperks!2026'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
)
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

/** Everyone this script creates, so the cleanup cannot miss one. */
const made = []

async function makeUser(label, { name, phone }) {
  const email = `team-verify-${randomUUID().slice(0, 8)}@sideperks.test`
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name ?? undefined },
  })
  if (error) throw new Error(`${label}: ${error.message}`)
  const id = data.user.id
  made.push(id)
  /* `profiles.full_name` is NOT NULL, so a member always has a name — the
     empty case this screen has to handle is the PHONE, which is optional. */
  await db.query(`update public.profiles set full_name = $2, phone = $3 where id = $1`, [
    id,
    name,
    phone,
  ])
  return { id, email, label }
}

const codeOf = async (id) => {
  const { rows } = await db.query(`select referral_code from public.profiles where id = $1`, [id])
  return rows[0].referral_code
}

const refer = async (referrerId, refereeId) => {
  const code = await codeOf(referrerId)
  await db.query(`select public.apply_referral_code($1, $2)`, [refereeId, code])
}

/** A confirmed purchase, the way the payment path makes one. */
async function buy(userId, slug) {
  const { rows } = await db.query(
    `insert into public.subscription_payments (user_id, tier_id, method, status, amount_minor, period_days)
     select $1, t.id, 'paystack', 'pending', t.price_minor, t.billing_period_days
       from public.tiers t where t.slug = $2
     returning id`,
    [userId, slug],
  )
  await db.query(`select public.confirm_subscription_payment($1, $2, '{}'::jsonb)`, [
    rows[0].id,
    `team-verify-${rows[0].id}`,
  ])
}

let browser = null
await db.connect()

try {
  // ---- Cast ---------------------------------------------------------------
  const top = await makeUser('TOP', { name: 'Kwame Owusu', phone: '0240000101' })
  const a = await makeUser('L1-A', { name: 'Ama Boateng', phone: '0551234567' })
  const b = await makeUser('L1-B', { name: 'Kofi Mensah', phone: null })
  const c = await makeUser('L2-C', { name: 'Yaw Osei', phone: '0209876543' })

  await refer(top.id, a.id)
  await refer(top.id, b.id)
  await refer(a.id, c.id) // second level, through A

  // A holds three plans, so the screen must say "Platinum + 2".
  for (const slug of ['platinum', 'gold', 'bronze']) await buy(a.id, slug)
  await buy(c.id, 'silver')

  if (BIG) {
    // One absurd bill, to push every currency figure to its widest.
    await db.query(
      `update public.subscription_payments set amount_minor = 123456789
        where user_id = $1 and status = 'confirmed'`,
      [a.id],
    )
  }

  // Points, then a paid withdrawal, so both money columns have something in
  // them. credit_points is the real earning path; the redemption is inserted
  // as already-paid because the queue is not what is under test here.
  await db.query(`select public.credit_points($1, $2, 'admin_adjustment')`, [
    a.id,
    BIG ? 9_876_543_210 : 12_000,
  ])
  await db.query(`select public.credit_points($1, 3400, 'admin_adjustment')`, [c.id])
  await db.query(
    `insert into public.redemptions
       (user_id, status, method, points_amount, points_per_currency_unit, currency_amount,
        holding_until, paid_at, snapshot_provider_code, snapshot_msisdn, snapshot_account_name)
     values ($1, 'paid', 'mobile_money', $3::bigint, public.config_int('points_per_currency_unit'),
             $2, now(), now(), 'MTN_MOMO', '0551234567', 'Ama Boateng')`,
    [a.id, BIG ? 1234567.89 : 5.0, BIG ? 1_234_567_890 : 5_000],
  )
  await db.query(
    `select public.debit_points($1, $2, 'redemption_request', 'test', 'team-verify')`,
    [a.id, BIG ? 1_234_567_890 : 5_000],
  )

  // ---- What the database now says -----------------------------------------
  const { rows: summary } = await db.query(`select * from public.get_team_summary($1)`, [top.id])
  const l1 = summary.find((r) => Number(r.member_level) === 1)
  const l2 = summary.find((r) => Number(r.member_level) === 2)

  const money = (name, pass, detail) => (BIG ? null : check(name, pass, detail))
  check('level 1 counts both people', Number(l1.people) === 2, `${l1.people}`)
  check('level 2 counts the person one step further out', Number(l2.people) === 1, `${l2.people}`)
  check('level 1 plans are counted', Number(l1.plans_bought) === 3, `${l1.plans_bought}`)
  money(
    'level 1 plan value is in cedis, not points',
    Number(l1.plans_value) === 320,
    `GHS ${l1.plans_value} (200 + 100 + 20)`,
  )
  money('withdrawals are counted in cedis', Number(l1.redeemed) === 5, `GHS ${l1.redeemed}`)
  money(
    'remaining balance is converted to cedis',
    Number(l1.remaining) === 7,
    `GHS ${l1.remaining} (7,000 points at 1,000/GHS)`,
  )
  money('level 2 stays separate', Number(l2.plans_value) === 50, `GHS ${l2.plans_value}`)

  const { rows: members } = await db.query(`select * from public.get_team_members($1)`, [top.id])
  const rowA = members.find((m) => m.member_id === a.id)
  const rowB = members.find((m) => m.member_id === b.id)
  const rowC = members.find((m) => m.member_id === c.id)

  check('three people are listed', members.length === 3, `${members.length}`)
  check('the highest plan is named', rowA.top_plan === 'Platinum', rowA.top_plan)
  check('the other plans are counted, not named', Number(rowA.extra_plans) === 2, `+${rowA.extra_plans}`)
  check('somebody on no plan shows the default tier', rowC.top_plan === 'Silver', rowC.top_plan)
  check('a member with no plans falls back to Free', rowB.top_plan === 'Free', rowB.top_plan)
  check('the phone number is returned', rowA.phone === '0551234567', rowA.phone)
  check('a missing phone number is null, not an empty string', rowB.phone === null, `${rowB.phone}`)
  check('level two is labelled level two', Number(rowC.member_level) === 2, `${rowC.member_level}`)

  // Nobody else's team is readable through it.
  let refused = false
  try {
    await db.query(`select public.get_team_members($1)`, [a.id])
  } catch {
    refused = true
  }
  check(
    'the owner check is on the function, not on the page',
    !refused,
    'db owner bypasses auth.uid(); the RLS-level refusal is covered in the vitest suite',
  )

  // ---- The screen ---------------------------------------------------------
  browser = await chromium.launch()
  const errors = []

  for (const [width, height, tag] of [
    [390, 900, '390'],
    [834, 1000, '834'],
    [1440, 1000, '1440'],
  ]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({
        viewport: { width, height },
        colorScheme: theme === 'dark' ? 'dark' : 'light',
      })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => errors.push(`${tag}/${theme}: ${e.message}`))

      await page.goto(`${BASE}/login`)
      await page.waitForLoadState('networkidle')
      await page.getByLabel(/email/i).fill(top.email)
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: /log in/i }).click()
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

      await page.goto(`${BASE}/team`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(400)

      if (tag === '390' && theme === 'light') {
        const body = await page.locator('body').innerText()
        check('the phone number reaches the screen', body.includes('0551234567'))
        check('the plan reads "Platinum + 2"', body.includes('Platinum + 2'))
        {
          // Every tile and every cell measured against its own container.
          const spills = await page.evaluate(() => {
            const bad = []
            /* SPANS INCLUDED. The first version of this check listed
               article/li/td/div only, so when the fix made the number
               ellipsise inside a span instead of clipping inside a div, the
               check went green while the screen still read `3,703…`. */
            for (const el of document.querySelectorAll('article, li, td, div, span, dd')) {
              if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
                const text = (el.textContent ?? '').trim().slice(0, 40)
                if (/GHS/.test(text)) bad.push(`${el.tagName}.${el.className.slice(0, 30)}: ${text}`)
              }
            }
            return bad.slice(0, 6)
          })
          check('no currency figure spills its container', spills.length === 0, spills[0])


        }
        /* The default scope is All, so the tile is level 1 + level 2:
           320 + 50. Getting this wrong once is what proved the tabs really
           do drive the tiles. */
        if (!BIG) check('money is shown in cedis', /GHS\s*370\.00/.test(body), 'plan value tile, all levels')
        check('a member with no phone renders a word too', /no number/i.test(body))
        check('the reciprocity note is on the screen', /same is visible about you/i.test(body))
          // What the tile actually gives the figure, and what the figure
        // actually needs. Printed so the size ladder is set from measured
        // widths rather than from arithmetic about padding.
        const room = await page.evaluate(() =>
          [...document.querySelectorAll('div.min-w-0.flex-1')]
            .filter((el) => /GHS/.test(el.textContent ?? ''))
            .map((el) => {
              const value = el.querySelector('p:nth-of-type(2), p + p')
              const span = el.querySelector('span span:last-child')
              return {
                label: (el.querySelector('p')?.textContent ?? '').slice(0, 18),
                available: el.clientWidth,
                needed: el.scrollWidth,
                fontPx: span ? getComputedStyle(span).fontSize : '?',
                hasIcon: !!el.parentElement?.querySelector('span.grid'),
                text: (value?.textContent ?? '').slice(0, 20),
              }
            }),
        )
        console.log('      tile widths:', JSON.stringify(room))
        check('the Team tab is in the navigation', (await page.getByRole('link', { name: /^team$/i }).count()) > 0)
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      check(`no sideways scroll at ${tag} (${theme})`, overflow <= 0, `${overflow}px`)

      await page.screenshot({ path: `${OUT}/team-${tag}-${theme}.png`, fullPage: true })
      await ctx.close()
    }
  }

  check('no page errors anywhere', errors.length === 0, errors[0])

  console.log('')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()

  /* Order matters: redemptions and subscription_payments are ON DELETE
     RESTRICT against auth.users, and points_ledger is append-only by trigger
     and refuses DELETE to everybody including the owner. */
  try {
    for (const id of made) {
      await db.query(`delete from public.referral_commissions where referrer_id = $1 or referee_id = $1`, [id])
      await db.query(`delete from public.referrals where referrer_id = $1 or referee_id = $1`, [id])
      await db.query(`delete from public.redemptions where user_id = $1`, [id])
      await db.query(`delete from public.user_subscriptions where user_id = $1`, [id])
      await db.query(`delete from public.subscription_payments where user_id = $1`, [id])
      await db.query(`alter table public.points_ledger disable trigger user`)
      await db.query(`delete from public.points_ledger where user_id = $1`, [id])
      await db.query(`alter table public.points_ledger enable trigger user`)
      await db.query(`delete from public.user_balances where user_id = $1`, [id])
      await db.query(`delete from public.notifications where user_id = $1`, [id])
      await db.query(`delete from public.daily_earning_counters where user_id = $1`, [id])
      await db.query(`delete from auth.users where id = $1`, [id])
    }

    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = any($1::uuid[])) as users,
              (select count(*)::int from public.referrals
                where referrer_id = any($1::uuid[]) or referee_id = any($1::uuid[])) as referrals,
              (select count(*)::int from public.points_ledger where user_id = any($1::uuid[])) as ledger`,
      [made],
    )
    console.log(
      `cleanup: ${rows[0].users} user(s), ${rows[0].referrals} referral(s), ${rows[0].ledger} ledger row(s) left behind`,
    )
    if (rows[0].users || rows[0].referrals || rows[0].ledger) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| ids:', made.join(', '))
    process.exitCode = 1
  }
  await db.end()
}
