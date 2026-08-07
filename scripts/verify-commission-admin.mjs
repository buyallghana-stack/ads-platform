/**
 * The affiliate business seen from the ADMIN side, driven through the screens.
 *
 * The database has been able to approve, pay and refuse commission since
 * migration 116, and `tests/affiliate/payouts.test.ts` proves it does that
 * correctly. Until 2026-08-07 nothing called any of it: eight admin functions
 * existed with no screen, and the four Phase 2 settings were unreachable. So
 * this run answers the operator's actual question — "I don't see that in the
 * admin dashboard" — by pressing the buttons:
 *
 *   1. THE QUEUE EXISTS AND SHOWS THE RIGHT MONEY. The NET, not the amount
 *      asked for: an operator who sends the gross has sent the fee back out
 *      with the money.
 *   2. APPROVE → MARK PAID SETTLES THE HOLD. Checked in the ledger, not on the
 *      screen — a status that changes colour while the money stays held is the
 *      failure this is looking for.
 *   3. A REJECTION GIVES THE MONEY BACK, exactly once, and the affiliate is
 *      shown the reason the operator typed.
 *   4. SUSPENDING DOES NOT TOUCH A BALANCE. The one property of that button
 *      somebody could get wrong and not notice for a month.
 *   5. THE FOUR SETTINGS ARE ON THE SETTINGS SCREEN, including the switch that
 *      opens the whole business.
 *
 * ── IT OPENS A LIVE MONEY SWITCH, SO IT CHECKS FIRST ──
 *
 * Same contract as verify-commission-withdraw.mjs: it refuses to start unless
 * its own fixtures are the only affiliates holding a positive balance, and it
 * restores every key it touched in the `finally`, then re-reads them.
 *
 *   node --env-file=.env.local scripts/verify-commission-admin.mjs
 *
 * Needs a server on BASE — `npm run build && npx next start -p 3100`.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

/* ⚠️ NEVER let a closed stdout kill this run. Piping it through `head` sends
   SIGPIPE/EPIPE, Node throws on the next write, and the process dies BEFORE
   the `finally` that restores a live money switch — which is exactly how
   `affiliate_payouts_enabled` was left ON on the shared project once. Swallow
   EPIPE and keep going: the restore matters more than the output. */
process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? ''
const ADMIN_EMAIL = process.env.SHOOT_EMAIL ?? 'admin@email.com'
const ADMIN_PASSWORD = process.env.SHOOT_PASSWORD ?? '1234'

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
const BALANCE_MINOR = 30_000
const ASK_MINOR = 10_000

/** Two fixtures: one gets paid, one gets refused. One open request each. */
const people = [
  { tag: 'paid', email: `cadmin-paid-${stamp}@test.invalid`, name: 'Adjoa Paidwell', userId: null, affiliateId: null, payoutId: null },
  { tag: 'refused', email: `cadmin-refused-${stamp}@test.invalid`, name: 'Kwesi Turndown', userId: null, affiliateId: null, payoutId: null },
]
const PASSWORD = `Cadmin!${stamp}`

let browser = null

const KEYS = ['affiliate_payouts_enabled', 'redemption_fee_percent', 'commission_payout_minimum_minor']
const original = new Map()

const setKey = (key, value) =>
  db.query(`update public.app_config set value = $2 where key = $1`, [key, value])

const body = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

const balanceOf = async (affiliateId) => {
  const { rows } = await db.query(`select public.affiliate_balance_minor($1) as b`, [affiliateId])
  return Number(rows[0].b)
}

await db.connect()

try {
  for (const key of KEYS) {
    const { rows } = await db.query(`select value from public.app_config where key = $1`, [key])
    if (!rows.length) throw new Error(`${key} is missing — a migration has not been applied`)
    original.set(key, rows[0].value)
  }
  console.log(`settings before: ${[...original].map(([k, v]) => `${k}=${v}`).join(', ')}\n`)

  const { rows: exposed } = await db.query(
    `select a.id from public.affiliate_accounts a where public.affiliate_balance_minor(a.id) > 0`,
  )
  if (exposed.length) {
    throw new Error(
      `REFUSING TO RUN: ${exposed.length} affiliate account(s) already hold a positive balance. ` +
        `Opening affiliate_payouts_enabled would let them file a real withdrawal during this run.`,
    )
  }

  await setKey('redemption_fee_percent', '2.5')
  await setKey('commission_payout_minimum_minor', '5000')
  await setKey('affiliate_payouts_enabled', 'true')

  /* ---- fixtures, filed straight through the RPC ------------------------- */
  for (const person of people) {
    const { data, error } = await sb.auth.admin.createUser({
      email: person.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: person.name },
    })
    if (error) throw error
    person.userId = data.user.id

    await db.query(
      `insert into public.affiliate_accounts (user_id, affiliate_code, status, activated_at)
       values ($1, public.generate_affiliate_code(), 'active', now())`,
      [person.userId],
    )
    const { rows: acc } = await db.query(
      `select id from public.affiliate_accounts where user_id = $1`,
      [person.userId],
    )
    person.affiliateId = acc[0].id

    await db.query(
      `insert into public.commission_ledger
         (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
       values ($1, 'adjustment', $2, 'cleared', 'verify-commission-admin', $3)`,
      [person.affiliateId, BALANCE_MINOR, `verify-admin-${stamp}-${person.tag}`],
    )

    await db.query(
      `update public.payout_providers set rail_confirmed = true, is_active = true where code = 'MTN_MOMO'`,
    )
    await db.query(
      `select public.set_payout_details($1, 'mobile_money', null, null, null,
         (select id from public.payout_providers where code = 'MTN_MOMO'), $2, $3)`,
      [person.userId, person.tag === 'paid' ? '0244000881' : '0244000882', person.name],
    )
    await db.query(
      `update public.user_payout_details set last_changed_at = now() - interval '400 hours' where user_id = $1`,
      [person.userId],
    )

    const { rows: filed } = await db.query(
      `select id from public.request_commission_payout($1, $2)`,
      [person.userId, ASK_MINOR],
    )
    person.payoutId = filed[0].id
  }

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

  /* ---- 1. the section exists and is reachable from the nav -------------- */
  const navLink = page.locator('a[href$="/admin/affiliates"]').first()
  /* The link's own text carries the waiting-count badge, so this doubles as
     proof the badge counts commission withdrawals rather than points. */
  const navText = ((await navLink.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
  check(
    'the admin sidebar has an Affiliates destination, badged with what is waiting',
    (await navLink.count()) > 0 && /Affiliates 2/.test(navText),
    navText,
  )

  const response = await page.goto(`${BASE}/admin/affiliates`, { waitUntil: 'networkidle' })
  check('/admin/affiliates loads', response?.status() === 200, `HTTP ${response?.status()}`)

  const queueText = await body(page)
  check(
    'both waiting withdrawals are in the queue',
    queueText.includes('Adjoa Paidwell') && queueText.includes('Kwesi Turndown'),
    'two rows',
  )
  check(
    'the row shows the NET, which is what actually leaves',
    queueText.includes('GHS 97.50'),
    queueText.match(/GHS 97\.50/)?.[0] ?? 'not shown',
  )
  check(
    'the summary states what is owed right now',
    /Owed now/i.test(queueText),
    queueText.match(/Owed now GHS [\d,.]+/i)?.[0] ?? 'not shown',
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-commission-queue.png`, fullPage: true })

  /* ---- 1b. AND IT EXISTS ON A PHONE ------------------------------------- */
  /* `TableShell` is `lg:block`. A screen built on it alone renders NOTHING
     below lg, which is where the operator actually works — this shipped that
     way for an hour and no assertion above would have noticed. */
  for (const width of [390, 834]) {
    await page.setViewportSize({ width, height: 900 })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const narrow = await page.evaluate(() => ({
      rows: document.querySelectorAll('main li').length,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    check(
      `the queue still has its rows at ${width}px`,
      narrow.rows >= 2,
      `${narrow.rows} card(s)`,
    )
    check(
      `and does not scroll sideways at ${width}px`,
      narrow.scrollWidth <= narrow.clientWidth + 1,
      `${narrow.scrollWidth} vs ${narrow.clientWidth}`,
    )
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  /* ---- 2. approve, then mark paid --------------------------------------- */
  const paidPerson = people[0]
  await page.getByRole('button', { name: /Review the withdrawal from Adjoa/i }).click()
  await page.waitForTimeout(600)
  const panelText = await body(page)
  check(
    'the panel separates what was asked from what is sent',
    /Asked for GHS 100\.00/i.test(panelText) && /They receive GHS 97\.50/i.test(panelText),
    'gross and net both stated',
  )
  check(
    'and says what the affiliate has left behind the request',
    /Left after this GHS 200\.00/i.test(panelText),
    panelText.match(/Left after this GHS [\d,.]+/i)?.[0] ?? 'not shown',
  )
  check(
    'the destination on screen is masked',
    !panelText.includes('0244000881'),
    'no whole number on the page',
  )

  await page.getByRole('button', { name: /^Approve$/i }).click()
  await page.waitForTimeout(2_500)

  const { rows: afterApprove } = await db.query(
    `select status from public.commission_payouts where id = $1`,
    [paidPerson.payoutId],
  )
  check('approving records the decision', afterApprove[0].status === 'approved', afterApprove[0].status)
  check(
    'and the money is STILL held, not paid',
    (await balanceOf(paidPerson.affiliateId)) === BALANCE_MINOR - ASK_MINOR,
    `${await balanceOf(paidPerson.affiliateId)} minor`,
  )

  await page.goto(`${BASE}/admin/affiliates`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: /Approved/i }).click().catch(() => {})
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Review the withdrawal from Adjoa/i }).click()
  await page.waitForTimeout(600)

  /* Marking paid without a reference must be impossible — it is the only
     proof the transfer happened. */
  const markPaidButton = page.getByRole('button', { name: /^Mark as paid$/i })
  check(
    'mark-paid is refused until a transfer reference is recorded',
    await markPaidButton.isDisabled(),
    'disabled with an empty reference',
  )

  await page.locator('input[placeholder*="MoMo"]').fill(`MOMO-${stamp}`)
  await page.waitForTimeout(200)
  await markPaidButton.click()
  await page.waitForTimeout(2_500)

  const { rows: afterPaid } = await db.query(
    `select status, external_reference, paid_at from public.commission_payouts where id = $1`,
    [paidPerson.payoutId],
  )
  check('marking paid records it', afterPaid[0].status === 'paid', afterPaid[0].status)
  check(
    'with the reference the operator typed',
    afterPaid[0].external_reference === `MOMO-${stamp}`,
    afterPaid[0].external_reference,
  )
  const { rows: settled } = await db.query(
    `select entry_type, status, amount_minor::text
       from public.commission_ledger
      where affiliate_id = $1 and entry_type = 'payout'`,
    [paidPerson.affiliateId],
  )
  check(
    'and the hold is settled in the ledger as one payout row',
    settled.length === 1 && Number(settled[0].amount_minor) === -ASK_MINOR,
    settled.map((r) => `${r.entry_type}/${r.status}/${r.amount_minor}`).join(', '),
  )
  check(
    'the balance is what is left after paying, not less',
    (await balanceOf(paidPerson.affiliateId)) === BALANCE_MINOR - ASK_MINOR,
    `${await balanceOf(paidPerson.affiliateId)} minor`,
  )

  /* ---- 3. reject, with a reason the affiliate is shown ------------------- */
  const refused = people[1]
  await page.goto(`${BASE}/admin/affiliates`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Review the withdrawal from Kwesi/i }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /^Reject$/i }).click()
  await page.waitForTimeout(300)

  const confirmReject = page.getByRole('button', { name: /Reject and tell them/i })
  check(
    'a rejection cannot be filed without a reason',
    await confirmReject.isDisabled(),
    'disabled while the reason is empty',
  )

  const REASON = 'Name on the MoMo account does not match the affiliate.'
  await page.locator('textarea').first().fill(REASON)
  await page.waitForTimeout(200)
  await confirmReject.click()
  await page.waitForTimeout(2_500)

  const { rows: afterReject } = await db.query(
    `select status, review_notes from public.commission_payouts where id = $1`,
    [refused.payoutId],
  )
  check('rejecting records the decision', afterReject[0].status === 'rejected', afterReject[0].status)
  check(
    'and stores the operator’s words, not a code',
    afterReject[0].review_notes === REASON,
    afterReject[0].review_notes,
  )
  check(
    'the money goes back, exactly once',
    (await balanceOf(refused.affiliateId)) === BALANCE_MINOR,
    `${await balanceOf(refused.affiliateId)} minor`,
  )

  /* ---- 4. the roster, and what suspending does -------------------------- */
  const peopleResponse = await page.goto(`${BASE}/admin/affiliates/people`, {
    waitUntil: 'networkidle',
  })
  check('/admin/affiliates/people loads', peopleResponse?.status() === 200, `HTTP ${peopleResponse?.status()}`)

  const rosterText = await body(page)
  check(
    'the roster lists the affiliates with their balances',
    rosterText.includes('Kwesi Turndown') && /GHS 300\.00/.test(rosterText),
    rosterText.match(/GHS 300\.00/)?.[0] ?? 'balance not shown',
  )

  /* The roster is built on the same shell, so it carries the same risk. */
  await page.setViewportSize({ width: 390, height: 900 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const rosterNarrow = await page.evaluate(() => ({
    rows: document.querySelectorAll('main li').length,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  check('the roster still has its rows at 390px', rosterNarrow.rows >= 2, `${rosterNarrow.rows} card(s)`)
  check(
    'and does not scroll sideways at 390px',
    rosterNarrow.scrollWidth <= rosterNarrow.clientWidth + 1,
    `${rosterNarrow.scrollWidth} vs ${rosterNarrow.clientWidth}`,
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: /Open Kwesi Turndown/i }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /^Suspend$/i }).click()
  await page.waitForTimeout(300)
  const suspendText = await body(page)
  check(
    'the suspend step says in words that the money is untouched',
    /does not touch the GHS 300\.00/i.test(suspendText),
    suspendText.match(/does not touch the GHS [\d,.]+/i)?.[0] ?? 'not stated',
  )

  await page.locator('textarea').first().fill('Verification run — reinstated immediately.')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Suspend this affiliate/i }).click()
  await page.waitForTimeout(2_500)

  const { rows: suspended } = await db.query(
    `select status from public.affiliate_accounts where id = $1`,
    [refused.affiliateId],
  )
  check('suspending takes effect', suspended[0].status === 'suspended', suspended[0].status)
  check(
    'and the balance is exactly as it was',
    (await balanceOf(refused.affiliateId)) === BALANCE_MINOR,
    `${await balanceOf(refused.affiliateId)} minor`,
  )

  await page.goto(`${BASE}/admin/affiliates/people`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: /Suspended/i }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Open Kwesi Turndown/i }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /^Reinstate$/i }).click()
  await page.waitForTimeout(2_500)
  const { rows: back } = await db.query(
    `select status from public.affiliate_accounts where id = $1`,
    [refused.affiliateId],
  )
  check('and reinstating puts them back', back[0].status === 'active', back[0].status)

  /* ---- 5. the settings the operator could not find ---------------------- */
  await page.goto(`${BASE}/admin/config`, { waitUntil: 'networkidle' })
  const configText = await body(page)
  for (const [label, key] of [
    ['Affiliates can withdraw commission', 'affiliate_payouts_enabled'],
    ['Smallest commission withdrawal', 'commission_payout_minimum_minor'],
    ['Default rate for the seller', 'affiliate_default_l1_percent'],
    ['Default rate for their recruiter', 'affiliate_default_l2_percent'],
  ]) {
    check(`platform settings carries ${key}`, configText.includes(label), label)
  }
  check(
    'and they are grouped as the second business, not mixed into referrals',
    /Affiliate business/i.test(configText),
    'group heading present',
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-affiliate-settings.png`, fullPage: true })

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
    for (const [key, value] of original) await setKey(key, value)
    const { rows: after } = await db.query(
      `select key, value from public.app_config where key = any($1) order by key`,
      [KEYS],
    )
    console.log(`settings after:  ${after.map((r) => `${r.key}=${r.value}`).join(', ')}`)
    if (!after.every((r) => r.value === original.get(r.key))) {
      console.error('SETTINGS NOT RESTORED — a live money switch is still changed')
      process.exitCode = 1
    }

    for (const person of people) {
      if (!person.userId) continue
      await db.query(`delete from public.commission_payouts where user_id = $1`, [person.userId])
      if (person.affiliateId) {
        await db.query(`alter table public.commission_ledger disable trigger user`)
        await db.query(`delete from public.commission_ledger where affiliate_id = $1`, [
          person.affiliateId,
        ])
        await db.query(`alter table public.commission_ledger enable trigger user`)
      }
      await db.query(`delete from public.affiliate_accounts where user_id = $1`, [person.userId])
      await db.query(`delete from public.user_payout_details where user_id = $1`, [person.userId])
      for (const table of ['user_balances', 'notifications', 'fraud_signals']) {
        await db.query(`delete from public.${table} where user_id = $1`, [person.userId])
      }
      await db.query(`delete from auth.users where id = $1`, [person.userId])
    }

    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = any($1)) users,
              (select count(*)::int from pg_trigger
                where tgrelid = 'public.commission_ledger'::regclass
                  and tgenabled <> 'O' and not tgisinternal) disabled_triggers`,
      [people.map((p) => p.userId).filter(Boolean)],
    )
    console.log(`cleanup: ${rows[0].users} user(s), ${rows[0].disabled_triggers} disabled trigger(s)`)
    if (rows[0].users !== 0 || rows[0].disabled_triggers !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| users:', people.map((p) => p.userId).join(', '))
    process.exitCode = 1
  }
  await db.end()
}
