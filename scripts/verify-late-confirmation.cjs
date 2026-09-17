/*
  Did migration 230 land on the live database, and is the door still shut?

    node scripts/verify-late-confirmation.cjs

  Read only. Two questions, both about `confirm_subscription_payment`:

  1. Does the LIVE definition allow a `failed` payment through? Reading the
     migration file proves nothing about what is installed. A function can be
     replaced by a later migration, applied out of order, or edited by hand in
     the dashboard, and the file on disk goes on looking correct.

  2. ⚠️ Is EXECUTE still revoked from public, anon and authenticated?
     `create or replace function` RE-GRANTS execute to PUBLIC. Every
     redefinition of a money function reopens it to the anon key unless the
     migration closes it again, and nothing raises if it does not. This project
     has found seventeen functions readable with the publishable key exactly
     once, and it was this mechanism.
*/
const { Client } = require('pg')
const fs = require('fs')

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]
    }),
)

const target = env.PRODUCTION_DB_URL || env.SUPABASE_DB_URL
const ref = (target.match(/postgres\.([a-z0-9]+)/) || [])[1] || 'unknown project'

const FN = 'confirm_subscription_payment'

;(async () => {
  console.log('target: ' + ref + '\n')
  const client = new Client({ connectionString: target })
  await client.connect()
  let bad = 0
  try {
    const { rows } = await client.query(
      `select pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [FN],
    )
    if (rows.length !== 1) {
      console.log(`✗ expected one ${FN}, found ${rows.length}`)
      process.exitCode = 1
      return
    }
    const def = rows[0].def

    const allowsLate = /not in \('pending', 'failed'\)/.test(def)
    const alerts = def.includes('late_payment_confirmed')
    console.log((allowsLate ? '✓' : '✗') + ' a failed payment can be confirmed')
    console.log((alerts ? '✓' : '✗') + ' a late confirmation raises late_payment_confirmed')
    if (!allowsLate || !alerts) bad++

    /* The refusal that must survive. A refunded payment becoming a live plan
       again behind a late event is the failure this half exists to prevent. */
    const refusesRefund = /raise exception 'Payment is % and cannot be confirmed'/.test(def)
    console.log((refusesRefund ? '✓' : '✗') + ' a refunded payment is still refused')
    if (!refusesRefund) bad++

    const { rows: grants } = await client.query(
      `select coalesce(nullif(grantee, ''), 'PUBLIC') as grantee
         from information_schema.role_routine_grants
        where routine_schema = 'public' and routine_name = $1 and privilege_type = 'EXECUTE'`,
      [FN],
    )
    const held = grants.map((g) => g.grantee)
    const reachable = held.filter((g) => ['PUBLIC', 'anon', 'authenticated'].includes(g))

    if (reachable.length === 0) {
      console.log('✓ EXECUTE is not held by PUBLIC, anon or authenticated')
    } else {
      console.log('✗ EXECUTE IS REACHABLE FROM A BROWSER KEY: ' + reachable.join(', '))
      console.log("  fix: revoke execute on function public." + FN + '(uuid, text, jsonb) from public, anon, authenticated;')
      bad++
    }
    console.log('  holders: ' + (held.join(', ') || 'none'))

    console.log(bad === 0 ? '\nAll good.' : `\n${bad} problem(s) above.`)
    if (bad > 0) process.exitCode = 1
  } finally {
    await client.end()
  }
})().catch((e) => {
  console.error('ERROR: ' + e.message)
  process.exit(1)
})
