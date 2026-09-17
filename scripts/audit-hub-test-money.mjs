/**
 * Which plans were granted against Paystack test money, and who holds them.
 *
 * The Tech Store wrote on 17 September 2026 to say the shared Paystack account
 * has been in TEST mode in production since the beginning, and that six
 * SidePerks intents were reported successful on it. Every one of those arrived
 * here over a correctly signed request and granted a plan. No money moved for
 * any of them.
 *
 * This answers the three questions their letter asks, from this app's own
 * data, and it answers a fourth they could not:
 *
 *   1. Do the six grants exist here.
 *   2. Whose accounts are they, and do they look real or internal.
 *   3. What did each grant hand out: a plan, and a referral commission to
 *      somebody else, which a reversal would have to claw back.
 *   4. IS `domain` IN WHAT THEY ALREADY SEND US. Their letter says to read it
 *      from the payload we record. It is not in the contract, so this prints
 *      the keys of a stored payload rather than assuming either way. If it is
 *      already there, the guard in decide.ts arms itself the moment this
 *      deploys, with no change needed on their side.
 *
 * READ ONLY. It opens the connection read only at the server, so it cannot
 * revoke, refund or edit anything even by accident. Deciding what to do about
 * a grant is the operator's call, and their letter says the same.
 *
 *     node scripts/audit-hub-test-money.mjs
 *
 * Reads PRODUCTION_DB_URL from .env.local. Pass --test to look at the test
 * database instead.
 */

import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
}

const key = process.argv.includes('--test') ? 'SUPABASE_DB_URL' : 'PRODUCTION_DB_URL'
const url = env[key]
if (!url) {
  console.error(`${key} is not set in .env.local`)
  process.exit(1)
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query('set session characteristics as transaction read only')

const q = async (sql, params = []) => (await client.query(sql, params)).rows
const money = (minor) => `GHS ${(Number(minor) / 100).toFixed(2)}`
const head = (title) => console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`)

try {
  head('0. The switch that decides what test money is worth')
  const [switchRow] = await q(
    `select value from public.app_config where key = 'hub_accept_test_payments'`,
  )
  console.log(
    switchRow === undefined
      ? '  ⚠️  The row is MISSING. Migration 231 has not been applied to this database,\n' +
        '      so the admin screen cannot save the setting and the guard has no override.'
      : switchRow.value === 'true'
        ? '  ⚠️  ON. Test money WILL grant a plan here. This is for a rehearsal only.'
        : '  Off. A payment reported from a test-mode Paystack account grants nothing.',
  )

  head('1. Every payment this app has, by status')
  for (const row of await q(`
    select status,
           count(*)                       as rows,
           sum(amount_minor)              as minor,
           min(created_at)::date::text    as first,
           max(created_at)::date::text    as last
      from public.subscription_payments
     group by status
     order by status
  `)) {
    console.log(`  ${row.status.padEnd(10)} ${String(row.rows).padStart(3)}  ${money(row.minor).padEnd(14)} ${row.first} to ${row.last}`)
  }

  head('2. Confirmed payments: who holds a plan, and did money move')
  const confirmed = await q(`
    select p.id,
           p.external_reference           as reference,
           p.amount_minor,
           p.currency_code,
           p.confirmed_at,
           p.method::text                 as method,
           t.name                         as tier,
           u.email::text                  as email,
           u.created_at                   as account_created,
           pr.full_name                   as person,
           coalesce(b.balance, 0)         as points_balance,
           /* is_admin() reads auth.uid() and there is no session here, so the
              role is asked of admin_role, which takes the id. */
           public.admin_role(p.user_id)   as admin_role,
           (select count(*) from public.ad_attempts a where a.user_id = p.user_id)  as ad_attempts,
           (select count(*) from public.redemptions r where r.user_id = p.user_id)  as withdrawals
      from public.subscription_payments p
      join public.tiers t on t.id = p.tier_id
      left join auth.users u on u.id = p.user_id
      left join public.profiles pr on pr.id = p.user_id
      left join public.user_balances b on b.user_id = p.user_id
     where p.status = 'confirmed'
     order by p.confirmed_at
  `)

  if (confirmed.length === 0) console.log('  None. Nothing was granted.')
  for (const row of confirmed) {
    console.log(`
  ${row.reference ?? '(no reference)'}  ${money(row.amount_minor)} ${row.currency_code.trim()}  ${row.tier}
    payment id      ${row.id}
    buyer           ${row.person ?? '(no profile)'}  <${row.email ?? 'deleted user'}>
    account opened  ${row.account_created ? row.account_created.toISOString() : '?'}
    confirmed       ${row.confirmed_at ? row.confirmed_at.toISOString() : '?'}  via ${row.method}
    activity        ${row.ad_attempts} ad attempts, ${row.points_balance} points, ${row.withdrawals} withdrawal requests
    account type    ${row.admin_role ? `${row.admin_role}, so internal` : 'ordinary account, treat as a real buyer until shown otherwise'}`)
  }

  head('3. What each grant handed out')
  for (const row of await q(`
    select p.external_reference                       as reference,
           t.name                                     as tier,
           s.status                                   as subscription_status,
           s.current_period_end
      from public.subscription_payments p
      join public.tiers t on t.id = p.tier_id
      left join public.user_subscriptions s
        on s.user_id = p.user_id and s.tier_id = p.tier_id
     where p.status = 'confirmed'
     order by p.confirmed_at
  `)) {
    const ends = row.current_period_end ? row.current_period_end.toISOString().slice(0, 10) : '-'
    console.log(`  ${(row.reference ?? '-').padEnd(22)} ${row.tier.padEnd(12)} subscription ${row.subscription_status ?? 'none'}, runs to ${ends}`)
  }

  head('4. Referral commission paid on those sales, which a reversal claws back')
  const commissions = await q(`
    select c.payment_id,
           p.external_reference as reference,
           c.level,
           c.points,
           c.amount_minor,
           c.percent_applied,
           c.reversed_at,
           u.email::text        as referrer_email,
           pr.full_name         as referrer
      from public.referral_commissions c
      left join public.subscription_payments p on p.id = c.payment_id
      left join auth.users u on u.id = c.referrer_id
      left join public.profiles pr on pr.id = c.referrer_id
     order by c.created_at
  `)
  if (commissions.length === 0) console.log('  None paid. Every rate is still 0.')
  for (const row of commissions) {
    console.log(`  ${(row.reference ?? '(no payment)').padEnd(22)} level ${row.level}  ${row.points} pts (${row.percent_applied}% of ${money(row.amount_minor)})  to ${row.referrer ?? '?'} <${row.referrer_email ?? '?'}>${row.reversed_at ? '  ALREADY REVERSED' : ''}`)
  }

  head('5. What the hub actually sends us: the keys of every stored payload')
  const shapes = await q(`
    select e.event,
           e.result,
           count(distinct e.id)                                 as rows,
           array_agg(distinct k order by k)                     as keys,
           count(distinct e.id) filter (where e.payload ? 'domain') as with_domain,
           array_agg(distinct e.payload->>'domain')
             filter (where e.payload ? 'domain')                as domains
      from public.hub_inbound_events e,
           lateral jsonb_object_keys(e.payload) k
     group by e.event, e.result
     order by e.event, e.result
  `)
  if (shapes.length === 0) console.log('  No inbound events recorded.')
  for (const row of shapes) {
    console.log(`  ${row.event} / ${row.result}: ${row.rows} events`)
    console.log(`    keys        ${row.keys.join(', ')}`)
    console.log(`    domain      ${row.with_domain > 0 ? row.domains.join(', ') : 'NOT SENT'}`)
  }

  head('6. One whole payload, so nothing is guessed')
  const sample = await q(`
    select request_id, event, result, received_at, jsonb_pretty(payload) as payload
      from public.hub_inbound_events
     where event = 'payment.success'
     order by received_at desc
     limit 1
  `)
  if (sample.length === 0) console.log('  No success event recorded.')
  else {
    const row = sample[0]
    console.log(`  ${row.received_at.toISOString()}  ${row.event} -> ${row.result}  request ${row.request_id}`)
    console.log(row.payload.split('\n').map((l) => '    ' + l).join('\n'))
  }

  head('7. Anything that arrived and was not acted on')
  const flags = await q(`
    select event, result, hub_reference, detail, received_at
      from public.hub_inbound_events
     where result not in ('confirmed', 'failed', 'reversed', 'already_done')
     order by received_at desc
  `)
  if (flags.length === 0) console.log('  Nothing flagged.')
  for (const row of flags) {
    console.log(`  ${row.received_at.toISOString()}  ${row.event} -> ${row.result}  ${row.hub_reference}\n    ${row.detail ?? ''}`)
  }

  console.log('\nRead only. Nothing above was changed.\n')
} finally {
  await client.end()
}
