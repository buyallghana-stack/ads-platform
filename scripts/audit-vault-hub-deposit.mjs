/**
 * Did a Vault deposit really go through the hub, and did real money pay for it.
 *
 * The Vault moved onto the Tech Store payment hub on 18 September 2026. Plans
 * were proven that way the day before, on one small live payment read back out
 * of the database afterwards. This is the same proof for a deposit, and it
 * exists because this project has twice been caught believing a request builder
 * instead of a record: Paystack recorded `sideperks.org` from a header nothing
 * in the payload carried, and a shared account sat in TEST mode in production
 * for months while every request looked correct.
 *
 * So nothing here asks what the code intended to send. Every section reads what
 * is stored.
 *
 *   0. WHICH DATABASE THIS IS. Printed first, and by project ref, because
 *      `SUPABASE_DB_URL` names the TEST project and reading it as production is
 *      a mistake that has already been made once on this feature.
 *   1. Is migration 232 actually here. Run this BEFORE deploying: the code
 *      calls `attach_vault_hub_reference`, and shipping ahead of the migration
 *      breaks the checkout after the hub has opened a payment.
 *   2. The switch and the gate that decide whether a buyer sees the button.
 *   3. Every deposit, newest first.
 *   4. ⚠️ THE DOMAIN ON THE NEWEST ONE. `live` is the proof. `test` means a key
 *      somewhere is still the old one, and nothing should have been granted.
 *   5. What the deposit opened, and what it will pay.
 *   6. The hub event behind it, including `payment_kind`, which has to say
 *      `vault` or the admin flags screen looks in the wrong table for the buyer.
 *
 * READ ONLY. The connection is opened read only at the server, so it cannot
 * change anything even by accident.
 *
 *     node scripts/audit-vault-hub-deposit.mjs           # production
 *     node scripts/audit-vault-hub-deposit.mjs --test    # sideperks-test
 */

import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
}

const onTest = process.argv.includes('--test')
const key = onTest ? 'SUPABASE_DB_URL' : 'PRODUCTION_DB_URL'
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
const yn = (ok) => (ok ? 'yes' : 'NO')

const problems = []

try {
  head('0. Which database this is')
  /* The ref is in the connection string's user, `postgres.<ref>`. Printed
     rather than inferred from which variable was read, because the whole point
     is that the two are easy to confuse. */
  const ref = /postgres\.([a-z0-9]+)/.exec(url)?.[1] ?? '(unreadable)'
  /* ⚠️ The app's URL is `NEXT_PUBLIC_SUPABASE_URL`, not `SUPABASE_URL`. Reading
     the wrong name made this line say "not production" while connected to
     production, which is the exact confusion the section exists to prevent, so
     both names are tried and an unreadable answer says so rather than "no". */
  const appUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? ''
  const appRef = /https:\/\/([a-z0-9]+)\./.exec(appUrl)?.[1] ?? null
  const verdict = !appRef
    ? 'UNKNOWN: no Supabase URL in .env.local to compare against'
    : ref === appRef
      ? 'PRODUCTION (it matches NEXT_PUBLIC_SUPABASE_URL)'
      : `not production (the app points at ${appRef})`
  console.log(`  variable   ${key}`)
  console.log(`  project    ${ref}`)
  console.log(`  this is    ${verdict}`)

  head('1. Is migration 232 here')
  const fns = await q(
    `select proname from pg_proc
      where proname in ('attach_vault_hub_reference', 'fail_vault_payment', 'reverse_vault_payment')
      order by proname`,
  )
  const present = fns.map((r) => r.proname)
  for (const name of ['attach_vault_hub_reference', 'fail_vault_payment', 'reverse_vault_payment']) {
    console.log(`  ${name.padEnd(28)} ${yn(present.includes(name))}`)
  }

  const [kindColumn] = await q(
    `select 1 as there from information_schema.columns
      where table_name = 'hub_inbound_events' and column_name = 'payment_kind'`,
  )
  console.log(`  hub_inbound_events.payment_kind  ${yn(Boolean(kindColumn))}`)

  const constraints = await q(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conname in ('vault_payments_status_check', 'vault_investments_status_check')
      order by conname`,
  )
  for (const row of constraints) console.log(`  ${row.conname}\n    ${row.def}`)

  const widened =
    constraints.every((r) => /refunded|cancelled/.test(r.def)) && constraints.length === 2
  if (present.length < 3 || !kindColumn || !widened) {
    problems.push('Migration 232 is NOT fully applied here. Do not deploy the code against this database.')
  }

  head('2. What a buyer sees')
  const config = await q(
    `select key, value from public.app_config
      where key in ('vault_enabled', 'hub_accept_test_payments') order by key`,
  )
  for (const row of config) console.log(`  ${row.key.padEnd(26)} ${row.value}`)
  if (!config.some((r) => r.key === 'vault_enabled' && r.value === 'true')) {
    console.log('  vault_enabled is not true, so the Vault page is off entirely.')
  }
  console.log('  The card button is gated on hubConfigured(), which is a Vercel')
  console.log('  variable and not visible from here. Check TECHSTORE_HUB_URL and')
  console.log('  HUB_OUTBOUND_SECRETS in the ads-platform project if it is missing.')

  head('3. Every Vault deposit, newest first')
  const deposits = await q(
    `select p.id, p.status, p.amount_minor, p.currency_code, p.external_reference,
            p.failure_reason, p.created_at, p.confirmed_at,
            coalesce(pr.full_name, '(deleted)') as person
       from public.vault_payments p
       left join public.profiles pr on pr.id = p.user_id
      order by p.created_at desc
      limit 20`,
  )
  if (deposits.length === 0) {
    console.log('  None. No deposit has ever been opened here.')
    problems.push('There is nothing to prove yet: no Vault deposit exists.')
  }
  for (const row of deposits) {
    console.log(
      `  ${row.created_at.toISOString().slice(0, 19)}  ${row.status.padEnd(9)} ` +
        `${money(row.amount_minor).padEnd(12)} ${row.external_reference ?? '(no reference)'}  ${row.person}`,
    )
    if (row.failure_reason) console.log(`      reason: ${row.failure_reason}`)
  }

  const [newest] = deposits
  if (newest) {
    head('4. ⚠️ The domain on the newest deposit')
    const [payload] = await q(
      `select provider_payload from public.vault_payments where id = $1`,
      [newest.id],
    )
    const stored = payload?.provider_payload ?? {}
    const keys = Object.keys(stored)
    console.log(`  payload keys   ${keys.length ? keys.join(', ') : '(empty)'}`)

    /* The hub forwards Paystack's own `live` or `test`. It may arrive at the
       top level or inside the event body, so look in both rather than deciding
       which shape to trust. */
    const domain = stored.domain ?? stored.data?.domain ?? null
    console.log(`  domain         ${domain ?? 'NOT SENT'}`)

    if (newest.status === 'confirmed' && domain === 'live') {
      console.log('  ✅ Real money. This is the proof.')
    } else if (domain === 'test') {
      problems.push(
        'The newest deposit carries domain=test. Something is still running a test key, ' +
          'and nothing should have been granted for it.',
      )
    } else if (newest.status === 'confirmed') {
      problems.push(
        'The newest deposit is confirmed but its stored payload names no domain, so this ' +
          'run does not prove live money. Check that the store forwards it.',
      )
    }

    head('5. What it opened')
    const investments = await q(
      `select id, status, amount_minor, expected_return_minor, period_days,
              daily_return_percent, started_at, ends_at, claimed_points
         from public.vault_investments where payment_id = $1`,
      [newest.id],
    )
    if (investments.length === 0) console.log('  No investment. Correct unless the deposit is confirmed.')
    for (const row of investments) {
      console.log(`  status         ${row.status}`)
      console.log(`  locked         ${money(row.amount_minor)} for ${row.period_days} days at ${row.daily_return_percent}% a day`)
      console.log(`  pays back      ${money(row.expected_return_minor)} on ${row.ends_at.toISOString().slice(0, 10)}`)
      if (row.claimed_points !== null) console.log(`  claimed        ${row.claimed_points} points`)
    }
    if (newest.status === 'confirmed' && investments.length !== 1) {
      problems.push('A confirmed deposit must have exactly one investment behind it.')
    }

    head('6. The hub event behind it')
    if (!newest.external_reference) {
      console.log('  The deposit carries no reference, so no event can be matched to it.')
    } else {
      const events = await q(
        `select request_id, event, result, detail, payment_id, payment_kind, received_at
           from public.hub_inbound_events
          where hub_reference = $1
          order by received_at`,
        [newest.external_reference],
      )
      if (events.length === 0) {
        console.log('  None. The return page settled it before the hub POSTed, which is allowed.')
      }
      for (const row of events) {
        console.log(
          `  ${row.received_at.toISOString().slice(0, 19)}  ${row.event.padEnd(17)} ` +
            `${row.result.padEnd(12)} kind=${row.payment_kind}`,
        )
        if (row.detail) console.log(`      ${row.detail}`)
        if (row.payment_kind !== 'vault') {
          problems.push(
            `An event for a Vault deposit is recorded as payment_kind=${row.payment_kind}. The ` +
              'admin flags screen will read the buyer name from the wrong table.',
          )
        }
        if (['mismatch', 'test_mode', 'error', 'unknown_reference'].includes(row.result)) {
          problems.push(`The hub event was refused: ${row.result}. Nothing was granted.`)
        }
      }
    }
  }

  head('Verdict')
  if (problems.length === 0) {
    console.log('  Nothing to report. Every section read back what it should.')
  } else {
    for (const line of problems) console.log(`  ⚠️  ${line}`)
  }
} finally {
  await client.end()
}
