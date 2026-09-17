/**
 * Take back a plan that was granted against money which never moved.
 *
 * WHY THIS EXISTS. The Tech Store's Paystack account was in TEST mode in
 * production from the beginning. A `payment.success` from it is a real event,
 * correctly signed and honestly reported, describing a payment that did not
 * happen. One reached this app and granted a Bronze plan.
 *
 * There is no "void" on `subscription_payments`, and inventing one would be a
 * second answer to a question `reverse_subscription_payment` already answers:
 * revoke the plan, claw back any referral commission, in one transaction. So a
 * grant against test money is reversed rather than erased, and the reason is
 * written on the row where anyone reading it later can see what happened.
 *
 * ⚠️ THIS IS A WRITE, AND IT IS THE ONLY ONE IN THIS REPO'S SCRIPTS THAT
 * TOUCHES A CONFIRMED PAYMENT. It refuses to run without `--confirm`, prints
 * the row before and after, and rolls back if anything raises. It also refuses
 * a payment that is not `confirmed`, because reversing a reversal is not a
 * thing anybody means to do.
 *
 *     node scripts/revoke-test-money-grant.mjs <payment-id>            # shows only
 *     node scripts/revoke-test-money-grant.mjs <payment-id> --confirm  # acts
 *
 * Find the id with `scripts/audit-hub-test-money.mjs`.
 */

import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const paymentId = process.argv[2]
const confirmed = process.argv.includes('--confirm')

if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) {
  console.error('Usage: node scripts/revoke-test-money-grant.mjs <payment-id> [--confirm]')
  process.exit(1)
}

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
}

const url = env.PRODUCTION_DB_URL
if (!url) {
  console.error('PRODUCTION_DB_URL is not in .env.local')
  process.exit(1)
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const show = async (label) => {
  const { rows } = await client.query(
    `select p.status,
            p.failure_reason,
            p.external_reference,
            p.amount_minor,
            t.name                as tier,
            s.status              as subscription,
            s.current_period_end,
            (select count(*) from public.referral_commissions c
              where c.payment_id = p.id and c.reversed_at is null) as live_commissions
       from public.subscription_payments p
       join public.tiers t on t.id = p.tier_id
       left join public.user_subscriptions s
         on s.user_id = p.user_id and s.tier_id = p.tier_id
      where p.id = $1`,
    [paymentId],
  )
  const row = rows[0]
  if (!row) return null

  const ends = row.current_period_end ? row.current_period_end.toISOString().slice(0, 10) : '-'
  console.log(
    `  ${label.padEnd(8)} payment ${row.status.padEnd(10)} ${row.tier} ` +
      `GHS ${(Number(row.amount_minor) / 100).toFixed(2)}   ` +
      `subscription ${String(row.subscription ?? 'none').padEnd(9)} to ${ends}   ` +
      `commissions live: ${row.live_commissions}`,
  )
  if (row.failure_reason) console.log(`           reason: ${row.failure_reason}`)
  return row
}

try {
  console.log(`\nPayment ${paymentId}\n`)
  const before = await show('before')

  if (!before) {
    console.error('No payment carries that id on this database.')
    process.exitCode = 1
  } else if (before.status !== 'confirmed') {
    console.error(`\nThat payment is ${before.status}, not confirmed. Nothing to take back.`)
    process.exitCode = 1
  } else if (!confirmed) {
    console.log('\nNothing was changed. Pass --confirm to revoke the plan.\n')
  } else {
    await client.query('begin')
    try {
      await client.query(`select public.reverse_subscription_payment($1, $2)`, [
        paymentId,
        'Granted against a Paystack test-mode payment. No money moved.',
      ])
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }

    console.log('')
    await show('after')
    console.log('\nRevoked. The plan is gone and any referral commission came back with it.\n')
  }
} catch (error) {
  console.error('FAILED, nothing was changed:', error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
