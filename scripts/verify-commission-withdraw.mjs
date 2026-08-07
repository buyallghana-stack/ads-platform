/**
 * Withdrawing COMMISSION, driven through the real screens.
 *
 * `tests/affiliate/payouts.test.ts` proves the database refuses correctly. This
 * proves the screens in front of it tell the truth and actually connect — a
 * different failure and the more expensive one, because every part of it can be
 * perfect in isolation:
 *
 *   1. THE BUTTON POINTS AT THE RIGHT MONEY. The Withdraw button on /commission
 *      pointed at `/withdraw` — the POINTS withdrawal — for a day. Different
 *      balance, different minimum, different ledger, and exactly the mixing D27
 *      exists to prevent. It was invisible in review because
 *      `affiliate_payouts_enabled` is false, so the button never rendered.
 *      **A link that only appears once a money switch is thrown is a link
 *      nobody has ever clicked.** That is what this script exists for.
 *
 *   2. EVERY LINK OFF THIS SCREEN RESOLVES. `/profile/payout-details` reads
 *      perfectly and 404s; the route is `/profile/payout`. It was on the
 *      "you have nowhere to send money" empty state — the one link a person
 *      follows when they cannot withdraw at all — and on /market/account.
 *
 *   3. THE ARITHMETIC ON SCREEN IS THE ARITHMETIC IN THE ROW. Somebody who is
 *      shown GHS 97.50 and sent GHS 90 has been misled by software that was
 *      working perfectly.
 *
 * ── IT FLIPS A LIVE MONEY SWITCH, SO IT CHECKS BEFORE IT DOES ──
 *
 * `affiliate_payouts_enabled` is the licence gate for the whole affiliate
 * business. Turning it on for the duration of a test run would let any real
 * affiliate with a balance file a request in that window, so the run REFUSES
 * to start unless the only affiliate with a positive balance is its own
 * fixture. The precondition is checked, not assumed, and the switch is restored
 * in the `finally` and re-read afterwards.
 *
 *   node --env-file=.env.local scripts/verify-commission-withdraw.mjs
 *   BASE=http://localhost:3100 SHOTS=/tmp/shots \
 *     node --env-file=.env.local scripts/verify-commission-withdraw.mjs
 *
 * It needs a server already running on BASE — `npm run build && npm start`.
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
const EMAIL = `commission-${stamp}@test.invalid`
const PASSWORD = `Commission!${stamp}`
const PIN = '2846'
const MSISDN = '0244000777'
/** GHS 200.00 to start with, and GHS 100.00 goes out. */
const BALANCE_MINOR = 20_000
const ASK_MAJOR = '100'
const ASK_MINOR = 10_000

let userId = null
let affiliateId = null
let browser = null

const KEYS = [
  'affiliate_payouts_enabled',
  'redemption_fee_percent',
  'commission_payout_minimum_minor',
]
const original = new Map()

const setKey = (key, value) =>
  db.query(`update public.app_config set value = $2 where key = $1`, [key, value])

const body = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

const login = async (page) => {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

await db.connect()

try {
  for (const key of KEYS) {
    const { rows } = await db.query(`select value from public.app_config where key = $1`, [key])
    if (!rows.length) throw new Error(`${key} is missing — a migration has not been applied`)
    original.set(key, rows[0].value)
  }
  console.log(`settings before: ${[...original].map(([k, v]) => `${k}=${v}`).join(', ')}\n`)

  /* ---- the precondition, before anything is touched --------------------- */
  const { rows: exposed } = await db.query(
    `select a.id, public.affiliate_balance_minor(a.id) as balance
       from public.affiliate_accounts a
      where public.affiliate_balance_minor(a.id) > 0`,
  )
  if (exposed.length) {
    throw new Error(
      `REFUSING TO RUN: ${exposed.length} affiliate account(s) already hold a positive balance ` +
        `(${exposed.map((r) => r.balance).join(', ')} minor). Opening affiliate_payouts_enabled ` +
        `would let them file a real withdrawal during this run.`,
    )
  }

  /* ---- the fixture ------------------------------------------------------ */
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Commission Tester' },
  })
  if (error) throw error
  userId = data.user.id

  await db.query(
    `insert into public.affiliate_accounts (user_id, affiliate_code, status, activated_at)
     values ($1, public.generate_affiliate_code(), 'active', now())`,
    [userId],
  )
  const { rows: acc } = await db.query(
    `select id from public.affiliate_accounts where user_id = $1`,
    [userId],
  )
  affiliateId = acc[0].id

  await db.query(
    `insert into public.commission_ledger
       (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
     values ($1, 'adjustment', $2, 'cleared', 'verify-commission-withdraw', $3)`,
    [affiliateId, BALANCE_MINOR, `verify-withdraw-${stamp}`],
  )

  await db.query(
    `update public.payout_providers set rail_confirmed = true, is_active = true where code = 'MTN_MOMO'`,
  )
  await db.query(
    `select public.set_payout_details($1, 'mobile_money', null, null, null,
       (select id from public.payout_providers where code = 'MTN_MOMO'), $2, 'Commission Tester')`,
    [userId, MSISDN],
  )
  /* Past the 48-hour cool-off, which is the point of the cool-off — a fixture
     that skips it would also skip the only thing standing between a stolen
     account and a redirected payment. */
  await db.query(
    `update public.user_payout_details set last_changed_at = now() - interval '400 hours' where user_id = $1`,
    [userId],
  )
  await db.query(`select public.set_withdrawal_pin($1, $2)`, [userId, PIN])

  await setKey('redemption_fee_percent', '2.5')
  await setKey('commission_payout_minimum_minor', '5000')

  browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await login(page)

  /* ---- 1. closed: the switch is off, and the screen says so ------------- */
  await setKey('affiliate_payouts_enabled', 'false')
  await page.goto(`${BASE}/commission/withdraw`, { waitUntil: 'networkidle' })
  const closedText = await body(page)
  check(
    'with the switch off the screen refuses instead of offering a form',
    /not open yet/i.test(closedText) && (await page.locator('#cw-amount').count()) === 0,
    closedText.match(/Withdrawals are not open yet/i)?.[0] ?? 'no refusal shown',
  )
  if (SHOTS)
    await page.screenshot({
      path: `${SHOTS}/commission-closed.png`,
      fullPage: true,
    })

  /* ---- 2. the button on /commission points at COMMISSION ---------------- */
  await setKey('affiliate_payouts_enabled', 'true')
  await page.goto(`${BASE}/commission`, { waitUntil: 'networkidle' })
  const withdrawLink = page.locator('a[href$="/commission/withdraw"]')
  const pointsLink = page.locator('a[href$="/withdraw"]:not([href*="commission"])')
  check(
    'the Withdraw button on Earnings goes to the COMMISSION withdrawal',
    (await withdrawLink.count()) === 1 && (await pointsLink.count()) === 0,
    `commission links: ${await withdrawLink.count()}, points links: ${await pointsLink.count()}`,
  )

  await withdrawLink.first().click()
  await page.waitForURL(/\/commission\/withdraw/, { timeout: 15_000 })
  check('and it lands on the commission withdrawal screen', true, page.url())

  /* ---- 3. the balance, the minimum and the destination ------------------ */
  const formText = await body(page)
  check(
    'it states the commission balance, not the points balance',
    /Available GHS 200\.00/i.test(formText),
    formText.match(/Available GHS [\d.,]+/i)?.[0] ?? 'not shown',
  )
  check(
    'and the affiliate minimum, not the points one',
    /Minimum GHS 50\.00/i.test(formText),
    formText.match(/Minimum GHS [\d.,]+/i)?.[0] ?? 'not shown',
  )
  check(
    'the destination is masked — the full number never reaches the page',
    !formText.includes(MSISDN) && formText.includes(MSISDN.slice(-4)),
    formText.match(/••••\d+/)?.[0] ?? 'no masked number',
  )

  /* ---- 4. the refusals a person actually hits --------------------------- */
  const amountField = page.locator('#cw-amount')
  await amountField.fill('10')
  await page.waitForTimeout(300)
  check(
    'below the minimum is refused before anything is submitted',
    /The least you can withdraw is GHS 50\.00/i.test(await body(page)),
    'client-side',
  )

  await amountField.fill('500')
  await page.waitForTimeout(300)
  check(
    'more than the balance is refused too',
    /You only have GHS 200\.00/i.test(await body(page)),
    'client-side',
  )

  /* ---- 5. the arithmetic, before confirming ----------------------------- */
  await amountField.fill(ASK_MAJOR)
  await page.waitForTimeout(400)
  const mathText = await body(page)
  check(
    'the fee is shown with its percentage before anybody confirms',
    /Fee \(2\.5%\) − GHS 2\.50/i.test(mathText),
    mathText.match(/Fee \([\d.]+%\) − GHS [\d.]+/i)?.[0] ?? 'not shown',
  )
  check(
    'and the net beside it, which is the figure that will land',
    /You receive GHS 97\.50/i.test(mathText),
    mathText.match(/You receive GHS [\d.]+/i)?.[0] ?? 'not shown',
  )
  if (SHOTS)
    await page.screenshot({
      path: `${SHOTS}/commission-amount.png`,
      fullPage: true,
    })

  /* ---- 6. a wrong PIN does not move money ------------------------------- */
  await page
    .getByRole('button', { name: /continue/i })
    .first()
    .click()
  await page.waitForTimeout(400)
  await page.locator('#cw-pin').fill('1111')
  await page.getByRole('button', { name: /confirm withdrawal/i }).click()
  await page.waitForTimeout(2_500)
  const wrongText = await body(page)
  check(
    'a wrong PIN is refused and says how many attempts are left',
    /attempts left/i.test(wrongText),
    wrongText.match(/That PIN is not right\. \d+ attempts left\./i)?.[0] ?? 'no attempts message',
  )
  const { rows: afterWrong } = await db.query(
    `select public.affiliate_balance_minor($1) as balance`,
    [affiliateId],
  )
  check(
    'and nothing left the balance',
    Number(afterWrong[0].balance) === BALANCE_MINOR,
    `${afterWrong[0].balance} minor`,
  )

  /* ---- 7. the real request ---------------------------------------------- */
  await page.locator('#cw-pin').fill(PIN)
  await page.getByRole('button', { name: /confirm withdrawal/i }).click()
  await page.waitForTimeout(3_000)
  const doneText = await body(page)
  check(
    'the right PIN files the request',
    /Withdrawal requested/i.test(doneText),
    doneText.slice(0, 90),
  )
  check(
    'the success screen repeats the net, not the requested amount, as the headline',
    /You receive GHS 97\.50/i.test(doneText),
    doneText.match(/You receive GHS [\d.]+/i)?.[0] ?? 'not shown',
  )
  const reference = doneText.match(/CMS-[A-Z0-9]{6}/)?.[0] ?? null
  check('and a reference an operator can be quoted on the phone', Boolean(reference), reference)
  if (SHOTS)
    await page.screenshot({
      path: `${SHOTS}/commission-done.png`,
      fullPage: true,
    })

  /* ---- 8. the row behind it -------------------------------------------- */
  const { rows: payouts } = await db.query(
    `select id, amount_minor::text, fee_percent::text, fee_minor::text, net_minor::text, status, method
       from public.commission_payouts where user_id = $1`,
    [userId],
  )
  check('exactly one payout row exists', payouts.length === 1, `${payouts.length} row(s)`)
  const row = payouts[0] ?? {}
  check(
    'the row carries what the screen promised',
    Number(row.amount_minor) === ASK_MINOR &&
      Number(row.fee_minor) === 250 &&
      Number(row.net_minor) === 9_750,
    `amount ${row.amount_minor}, fee ${row.fee_minor}, net ${row.net_minor}`,
  )
  check(
    'the fee percentage is frozen onto it',
    Number(row.fee_percent) === 2.5,
    `${row.fee_percent}%`,
  )
  check('it is waiting for a decision, not paid', row.status === 'requested', row.status)
  check(
    'and the reference on screen is derived from that row',
    reference === `CMS-${String(row.id).replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    `${reference} vs row ${row.id}`,
  )

  /* ---- 9. the money is held immediately, and Earnings says so ----------- */
  const { rows: afterRequest } = await db.query(
    `select public.affiliate_balance_minor($1) as balance`,
    [affiliateId],
  )
  check(
    'the balance drops the moment it is requested, not on approval',
    Number(afterRequest[0].balance) === BALANCE_MINOR - ASK_MINOR,
    `${afterRequest[0].balance} minor`,
  )

  await page.goto(`${BASE}/commission`, { waitUntil: 'networkidle' })
  const statementText = await body(page)
  check('Earnings shows the reduced balance', /GHS 100\.00/.test(statementText), 'balance updated')
  check(
    'and the request in the queue, with the net beside it',
    /GHS 97\.50/.test(statementText),
    statementText.match(/GHS 97\.50/)?.[0] ?? 'net not shown',
  )

  /* ---- 10. a second request while one is open --------------------------- */
  /* "One at a time" is a unique INDEX, so the refusal Postgres writes is
     `duplicate key value violates unique constraint …`. The form must not be
     reachable at all, and if the race is ever hit the words must still be
     words. */
  await page.goto(`${BASE}/commission/withdraw`, { waitUntil: 'networkidle' })
  const secondText = await body(page)
  check(
    'with one already on the way the form is not offered at all',
    /already have one on the way/i.test(secondText) &&
      (await page.locator('#cw-amount').count()) === 0,
    secondText.match(/You already have one on the way/i)?.[0] ?? secondText.slice(0, 90),
  )
  check(
    'and no constraint name is ever shown to a person',
    !/duplicate key|violates unique constraint|commission_payouts_/i.test(secondText),
    secondText.match(/duplicate key[^.]*/i)?.[0] ?? 'clean',
  )
  const { rows: stillOne } = await db.query(
    `select count(*)::int as n from public.commission_payouts where user_id = $1`,
    [userId],
  )
  check('and no second row was written', stillOne[0].n === 1, `${stillOne[0].n} row(s)`)

  /* ---- 11. every link off these screens resolves ------------------------ */
  const links = ['/profile/payout', '/profile/pin', '/commission', '/market/account']
  for (const href of links) {
    const response = await page.goto(`${BASE}${href}`, {
      waitUntil: 'domcontentloaded',
    })
    check(`${href} resolves`, response?.status() === 200, `HTTP ${response?.status()}`)
  }

  /* The dead link this run was written after: it must not come back on any
     screen, under any name. */
  const stale = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h.includes('payout-details')),
  )
  check(
    'no screen still links to the /profile/payout-details route that does not exist',
    stale.length === 0,
    stale.join(', '),
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
    for (const [key, value] of original) await setKey(key, value)
    const { rows: back } = await db.query(
      `select key, value from public.app_config where key = any($1) order by key`,
      [KEYS],
    )
    console.log(`settings after:  ${back.map((r) => `${r.key}=${r.value}`).join(', ')}`)
    if (!back.every((r) => r.value === original.get(r.key))) {
      console.error('SETTINGS NOT RESTORED — a live money switch is still changed')
      process.exitCode = 1
    }

    if (userId) {
      await db.query(`delete from public.commission_payouts where user_id = $1`, [userId])
      /* The ledger is append-only by trigger, exactly like points_ledger, so a
         fixture cannot be removed without turning that off and back on. */
      if (affiliateId) {
        await db.query(`alter table public.commission_ledger disable trigger user`)
        await db.query(`delete from public.commission_ledger where affiliate_id = $1`, [
          affiliateId,
        ])
        await db.query(`alter table public.commission_ledger enable trigger user`)
      }
      await db.query(`delete from public.affiliate_accounts where user_id = $1`, [userId])
      await db.query(`delete from public.user_payout_details where user_id = $1`, [userId])
      for (const table of ['user_balances', 'notifications', 'fraud_signals']) {
        await db.query(`delete from public.${table} where user_id = $1`, [userId])
      }
      await db.query(`delete from auth.users where id = $1`, [userId])
    }

    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = $1) users,
              (select count(*)::int from pg_trigger
                where tgrelid = 'public.commission_ledger'::regclass
                  and tgenabled <> 'O' and not tgisinternal) disabled_triggers`,
      [userId],
    )
    console.log(
      `cleanup: ${rows[0].users} user(s), ${rows[0].disabled_triggers} disabled trigger(s)`,
    )
    if (rows[0].users !== 0 || rows[0].disabled_triggers !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId, '| affiliate:', affiliateId)
    process.exitCode = 1
  }
  await db.end()
}
