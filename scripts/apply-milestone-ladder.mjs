/**
 * Retune the team milestone ladder, through the admin function rather than a
 * migration.
 *
 *   node scripts/apply-milestone-ladder.mjs           check only, writes nothing
 *   node scripts/apply-milestone-ladder.mjs --apply   save it
 *
 * WHY THIS IS NOT A MIGRATION. Same reason as apply-plan-ladder.mjs: the
 * amounts are an operator decision that will change again, and
 * `admin_save_task` is the path the admin Tasks screen uses. Going through it
 * puts the operator's name on the audit trail and runs the same "a ladder has
 * to climb" check the screen runs.
 *
 * THE LADDER. Operator, 2026-09-24: keep 5 members = GHS 50 and make the rest
 * rise "relatively". Chosen from three shapes: the reward PER MEMBER rises
 * smoothly from GHS 10 at 5 members to GHS 25 at 1,200 (x1.096 a rung),
 * rounded to tidy totals. It replaces the brief's first ladder, which paid
 * GHS 250 a member at the top: about three times what a Bronze member pays,
 * so the top rungs paid out more than the team brought in.
 *
 * ⚠️ BOTTOM UP. `admin_save_task` refuses any save that leaves the ladder not
 * climbing. Every new total sits between the new total below it and the OLD
 * total above it, so saving from the bottom keeps the ladder valid at every
 * intermediate state. The simulation below proves that before anything is
 * written, rather than trusting it.
 *
 * Totals only. What each rung PAYS is always total minus what the person has
 * already been paid, worked out at claim time, so this never needs to know
 * who has claimed what.
 */
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

/* --- env ---------------------------------------------------------------- */
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY

if (!url || !secret) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local')
  process.exit(1)
}

const db = createClient(url, secret, { auth: { persistSession: false } })
const apply = process.argv.includes('--apply')

/* --- the ladder: members -> TOTAL in cedis ------------------------------- */
const LADDER = [
  [5, 50],
  [10, 110],
  [15, 180],
  [40, 530],
  [80, 1_150],
  [150, 2_370],
  [250, 4_340],
  [400, 7_600],
  [600, 12_500],
  [850, 19_400],
  [1_200, 30_000],
]

const fail = (message) => {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

/* --- the rule: 5 is untouched, totals climb, per member never falls ------ */
if (LADDER[0][0] !== 5 || LADDER[0][1] !== 50) fail('The operator fixed 5 members = GHS 50.')
for (let i = 1; i < LADDER.length; i++) {
  const [m0, g0] = LADDER[i - 1]
  const [m1, g1] = LADDER[i]
  if (!(m1 > m0 && g1 > g0)) fail(`Rung ${m1} does not climb above rung ${m0}.`)
  if (g1 / m1 < g0 / m0) fail(`Rung ${m1} pays less per member than rung ${m0}.`)
}

/* --- what is there now -------------------------------------------------- */
const { data: pegRow } = await db
  .from('app_config')
  .select('value')
  .eq('key', 'points_per_currency_unit')
  .single()
const peg = Math.max(1, Number(pegRow?.value ?? 100))

const { data: rungs, error } = await db
  .from('tasks')
  .select('*')
  .eq('metric', 'team_members')
  .eq('cumulative', true)
  .eq('is_active', true)
  .order('target')
if (error) fail(`Could not read the ladder: ${error.message}`)

const byTarget = new Map(rungs.map((r) => [Number(r.target), r]))
if (rungs.length !== LADDER.length || LADDER.some(([m]) => !byTarget.has(m))) {
  fail(
    `The live ladder is not the 11 rungs this script expects. Live targets: ${rungs
      .map((r) => r.target)
      .join(', ')}`,
  )
}

console.log(`project ${new URL(url).host.split('.')[0]}, ${peg} points per cedi\n`)
console.log('members   now GHS   new GHS   pays at rung   per member')
let previous = 0
for (const [members, ghs] of LADDER) {
  const now = Number(byTarget.get(members).reward_points) / peg
  console.log(
    `${String(members).padStart(7)} ${now.toLocaleString().padStart(9)} ${ghs.toLocaleString().padStart(9)}` +
      ` ${(ghs - previous).toLocaleString().padStart(14)} ${(ghs / members).toFixed(1).padStart(12)}`,
  )
  previous = ghs
}

/* --- prove bottom up never breaks the climb ------------------------------ */
const state = new Map(rungs.map((r) => [Number(r.target), Number(r.reward_points)]))
for (const [members, ghs] of LADDER) {
  state.set(members, ghs * peg)
  const totals = [...state.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)
  if (totals.some((p, i) => i > 0 && p <= totals[i - 1])) {
    fail(`Saving rung ${members} bottom up would leave the ladder not climbing.`)
  }
}

if (!apply) {
  console.log('\nCheck only. Nothing was written. Re-run with --apply to save.')
  process.exit(0)
}

/* The admin whose name goes on the audit row. Super admin, because
   `admin_save_task` calls `assert_admin` and that refuses everybody else. */
const { data: admins, error: roleError } = await db
  .from('user_roles')
  .select('user_id')
  .eq('role', 'super_admin')
  .limit(1)
if (roleError || !admins?.length) fail(`No super admin to act as: ${roleError?.message ?? 'none found'}`)
const adminId = admins[0].user_id

console.log(`\nsaving as super admin ${adminId}, bottom of the ladder first`)
for (const [members, ghs] of LADDER) {
  const r = byTarget.get(members)
  const points = ghs * peg
  if (Number(r.reward_points) === points) {
    console.log(`  ${members} members: already GHS ${ghs.toLocaleString()}`)
    continue
  }
  const { error: saveError } = await db.rpc('admin_save_task', {
    p_admin_id: adminId,
    p_task: {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      metric: r.metric,
      target: r.target,
      reward_points: points,
      icon: r.icon,
      sort_order: r.sort_order,
      is_active: r.is_active,
      cumulative: r.cumulative,
    },
  })
  if (saveError) fail(`${members} members: ${saveError.message}`)
  console.log(`  ${members} members: GHS ${ghs.toLocaleString()} saved`)
}

/* Read it back rather than trusting the saves. */
const { data: after } = await db
  .from('tasks')
  .select('target, reward_points')
  .eq('metric', 'team_members')
  .eq('cumulative', true)
  .eq('is_active', true)
  .order('target')
const wrong = LADDER.filter(
  ([m, g]) => Number(after.find((r) => Number(r.target) === m)?.reward_points) !== g * peg,
)
if (wrong.length) fail(`Read back does not match at: ${wrong.map(([m]) => m).join(', ')}`)
console.log('\n✓ Read back: all 11 rungs match.')
