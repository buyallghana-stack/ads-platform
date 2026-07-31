/**
 * A demo team on user@email.com, for the lawyer's review of the Team screen.
 *
 *   node --env-file=.env.local scripts/seed-team-demo.mjs         create
 *   node --env-file=.env.local scripts/seed-team-demo.mjs --drop  remove
 *
 * TEMPORARY BY CONSTRUCTION. Everything it creates is a fresh account whose
 * email ends `@sideperks.demo`, so `--drop` removes exactly what this script
 * made and can prove it. It never writes to user@email.com itself — the only
 * trace on that account is the `referrals` rows pointing AT it, which
 * disappear with the accounts. That matters: user@email.com is the operator's
 * real account, and the rule after the 2026-07-25 incident is that a cleanup
 * may only touch rows it can prove it created.
 *
 * THE DEMO ACCOUNTS ARE DISABLED once they are built, and that is deliberate:
 * `get_leaderboard` excludes disabled accounts, and seven invented names with
 * points would otherwise appear on the public board next to real users. The
 * Team screen does not filter on it, so they show there exactly as intended.
 * Everything is written BEFORE the accounts are disabled, because
 * `credit_points` refuses a disabled account.
 *
 * NOTHING IS PAID TO user@email.com. All six referral rates are 0 in live
 * config, and the script asserts that before it starts rather than assuming
 * it — if a rate were live, seven signups and six plan purchases would credit
 * the operator's own balance with real points.
 *
 * The phone numbers are deliberately patterned (024 000 00xx). They look like
 * numbers without being anybody's.
 */
import { randomUUID } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const DROP = process.argv.includes('--drop')
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? 'user@email.com'
const DOMAIN = 'sideperks.demo'
const PASSWORD = `demo-${randomUUID()}` // never used; the accounts are disabled

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

/**
 * The cast. `via` is the handle of whoever invited them — the owner when
 * absent, which is what makes somebody level one.
 */
const CAST = [
  {
    handle: 'ama',
    name: 'Ama Boateng',
    phone: '0240000011',
    plans: ['platinum', 'gold', 'bronze'],
    points: 8_100,
    withdrawn: 42.5,
  },
  { handle: 'kofi', name: 'Kofi Mensah', phone: '0540000022', plans: ['silver'], points: 3_400, withdrawn: 15 },
  { handle: 'yaa', name: 'Yaa Asantewaa', phone: '0200000033', plans: ['bronze'], points: 12_250, withdrawn: 0 },
  // No plan and almost no balance: the row that proves the empty cases render
  // as words rather than as gaps.
  { handle: 'kwesi', name: 'Kwesi Appiah', phone: null, plans: [], points: 600, withdrawn: 0 },

  // Level two — invited by the people above, not by the owner.
  { handle: 'adwoa', name: 'Adwoa Serwaa', via: 'ama', phone: '0270000044', plans: ['gold'], points: 5_500, withdrawn: 30 },
  { handle: 'kojo', name: 'Kojo Antwi', via: 'ama', phone: '0550000055', plans: [], points: 1_100, withdrawn: 0 },
  { handle: 'efua', name: 'Efua Mensimah', via: 'kofi', phone: '0500000066', plans: ['silver'], points: 2_750, withdrawn: 8 },
]

const emailFor = (handle) => `team-demo-${handle}@${DOMAIN}`

async function dropAll() {
  const { rows } = await db.query(
    `select id, email from auth.users where email like $1`,
    [`team-demo-%@${DOMAIN}`],
  )
  if (rows.length === 0) {
    console.log('nothing to remove')
    return
  }

  for (const { id, email } of rows) {
    // Order matters: redemptions and subscription_payments are ON DELETE
    // RESTRICT against auth.users, and points_ledger is append-only by
    // trigger and refuses DELETE to everybody including the owner.
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
    console.log(`removed ${email}`)
  }

  const { rows: left } = await db.query(
    `select (select count(*)::int from auth.users where email like $1) as users,
            (select count(*)::int from public.points_ledger l
               join auth.users u on u.id = l.user_id where u.email like $1) as ledger`,
    [`team-demo-%@${DOMAIN}`],
  )
  console.log(`left behind: ${left[0].users} account(s), ${left[0].ledger} ledger row(s)`)
  if (left[0].users || left[0].ledger) process.exitCode = 1
}

async function build() {
  // ---- The assertion that makes this safe -------------------------------
  const { rows: rates } = await db.query(
    `select key, value from public.app_config where key in
      ('referral_signup_bonus_points','referral_activation_bonus_points','referral_purchase_commission_percent',
       'referral_signup_bonus_points_l2','referral_activation_bonus_points_l2','referral_purchase_commission_percent_l2')`,
  )
  const live = rates.filter((r) => Number(r.value) > 0)
  if (live.length > 0) {
    throw new Error(
      `referral rates are live (${live.map((r) => `${r.key}=${r.value}`).join(', ')}) — ` +
        'this would credit real points to the owner. Set them to 0, seed, then set them back.',
    )
  }

  const { rows: owners } = await db.query(
    `select p.id, p.referral_code from public.profiles p
      join auth.users u on u.id = p.id where u.email = $1`,
    [OWNER_EMAIL],
  )
  if (owners.length === 0) throw new Error(`${OWNER_EMAIL} not found`)
  const owner = owners[0]
  console.log(`owner ${OWNER_EMAIL} (${owner.referral_code})`)

  /* Measured BEFORE and after, not asserted as an absolute. user@email.com
     already carries 1,000 points of referral history from `pnpm seed`
     (`reference_id = 'seed-ref-1'`, dated 12 and 19 July), so "the owner has
     0 referral points" was never true and the guard fired on its first run
     for a reason that had nothing to do with this script. What matters is
     that THIS run adds nothing. */
  const referralPoints = async () => {
    const { rows } = await db.query(
      `select coalesce(sum(amount), 0)::int as points from public.points_ledger
        where user_id = $1 and entry_type in ('referral_signup','referral_activation','referral_purchase')`,
      [owner.id],
    )
    return Number(rows[0].points)
  }
  const before = await referralPoints()

  const ids = {}

  for (const person of CAST) {
    const email = emailFor(person.handle)
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: person.name },
    })
    if (error) throw new Error(`${email}: ${error.message}`)
    const id = data.user.id
    ids[person.handle] = id

    await db.query(`update public.profiles set full_name = $2, phone = $3 where id = $1`, [
      id,
      person.name,
      person.phone,
    ])

    // Who invited them. The owner's code for level one, another demo
    // account's for level two — which is what puts them a step further out.
    const inviterId = person.via ? ids[person.via] : owner.id
    const { rows: code } = await db.query(
      `select referral_code from public.profiles where id = $1`,
      [inviterId],
    )
    await db.query(`select public.apply_referral_code($1, $2)`, [id, code[0].referral_code])

    for (const slug of person.plans) {
      const { rows: pay } = await db.query(
        `insert into public.subscription_payments (user_id, tier_id, method, status, amount_minor, period_days)
         select $1, t.id, 'paystack', 'pending', t.price_minor, t.billing_period_days
           from public.tiers t where t.slug = $2
         returning id`,
        [id, slug],
      )
      await db.query(`select public.confirm_subscription_payment($1, $2, '{}'::jsonb)`, [
        pay[0].id,
        `demo-${pay[0].id}`,
      ])
    }

    // Points first, then the withdrawal out of them, so the balance that is
    // left is the balance the screen should show.
    const credited = person.points + Math.round(person.withdrawn * 1000)
    if (credited > 0) {
      await db.query(`select public.credit_points($1, $2, 'admin_adjustment')`, [id, credited])
    }
    if (person.withdrawn > 0) {
      await db.query(
        `insert into public.redemptions
           (user_id, status, method, points_amount, points_per_currency_unit, currency_amount,
            holding_until, paid_at, snapshot_provider_code, snapshot_msisdn, snapshot_account_name)
         values ($1, 'paid', 'mobile_money', $2::bigint, public.config_int('points_per_currency_unit'),
                 $3, now(), now(), 'MTN_MOMO', $4, $5)`,
        [id, Math.round(person.withdrawn * 1000), person.withdrawn, person.phone ?? '0240000000', person.name],
      )
      await db.query(
        `select public.debit_points($1, $2, 'redemption_request', 'demo', $3)`,
        [id, Math.round(person.withdrawn * 1000), `team-demo-${person.handle}`],
      )
    }

    console.log(
      `  ${person.via ? 'level 2' : 'level 1'}  ${person.name.padEnd(16)} ${person.plans.join('+') || 'no plan'}`,
    )
  }

  // Last, because credit_points refuses a disabled account.
  await db.query(
    `update public.profiles
        set disabled_at = now(),
            disabled_reason = 'Demo account for the Team screen review (2026-07-31). Not a real user. Remove with scripts/seed-team-demo.mjs --drop.'
      where id = any($1::uuid[])`,
    [Object.values(ids)],
  )

  const { rows: check } = await db.query(
    `select * from public.get_team_summary($1)`,
    [owner.id],
  )
  console.log('')
  for (const row of check) {
    console.log(
      `level ${row.member_level}: ${row.people} people · ${row.plans_bought} plans · ` +
        `GHS ${row.plans_value} paid · GHS ${row.redeemed} withdrawn · GHS ${row.remaining} left`,
    )
  }

  const after = await referralPoints()
  console.log(
    `owner referral points: ${before} before, ${after} after — this run added ${after - before} (expected 0)`,
  )
  if (after !== before) process.exitCode = 1
}

await db.connect()
try {
  await dropAll()
  if (!DROP) await build()
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
