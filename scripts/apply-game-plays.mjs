/**
 * Retune the weekly game plays per plan, and let them stack.
 *
 *   node scripts/apply-game-plays.mjs           check only, writes nothing
 *   node scripts/apply-game-plays.mjs --apply   save it
 *
 * WHY THIS IS NOT A MIGRATION. Same reasoning as `apply-plan-ladder.mjs`:
 * plays per plan is an operator setting with its own admin screen, and a
 * migration would put today's numbers in a file that replays on every fresh
 * database and then disagrees with whatever the operator did next. This calls
 * `admin_set_tier_game_plays` and `admin_set_config` — the same two functions
 * the admin panel calls — so the setting has exactly one way in and one audit
 * trail.
 *
 * OPERATOR, 2026-09-22: PLAYS NOW STACK. `game_plays_combine_mode` moves from
 * `highest` to `sum_bonus`, so a member holding several plans gets each plan's
 * plays added on top of the free allowance, the way ad caps already do. This
 * reverses the 2026-07-30 decision, which was taken when plays were meant to
 * be the one benefit that did NOT stack.
 *
 * THE LADDER BELOW IS ALREADY WHAT PRODUCTION HOLDS, and it is restated here
 * rather than left implicit for two reasons. The migration files still say
 * Pearl grants 2 and Platinum 4, which the operator has since corrected in the
 * admin — so a reader checking the repository gets the wrong answer, and a
 * fresh database replayed from migrations would come up with a ladder that
 * stacks to something else entirely. And `sum_bonus` is what makes each rung's
 * number matter on its own: under `highest` only the largest was ever read, so
 * a rung set wrong was invisible.
 *
 * THE RULE IT ENFORCES. Read every plan in price order: paying more must buy
 * MORE plays, never the same number. This is the games half of the rule
 * `apply-plan-ladder.mjs` enforces for points an ad.
 *
 * ORDER MATTERS, AND IT IS LADDER FIRST, MODE LAST. While the mode is still
 * `highest` a half-finished run can only ever RAISE somebody's allowance,
 * because every number here is at or above the one it replaces. Flipping the
 * mode first would apply stacking to a ladder that is still half old.
 *
 * ⚠️ THIS COSTS PRIZE MONEY, AND THE GAMES ARE LIVE. Under `highest` the most
 * anybody could draw was the best single plan — four a week, because
 * everything dearer than Gold is `coming_soon` and cannot be bought. Under
 * `sum_bonus` a member holding all four plans on sale draws TEN. Every face
 * pays something (operator rule 4, there are no losing outcomes), so the prize
 * liability per stacked member goes up 2.5x. The prize table's daily and
 * weekly caps are the only thing bounding it; read them on the admin games
 * screen alongside this.
 *
 * ⚠️ SUM_BONUS ADDS UP THE ROWS IT IS GIVEN. `user_target_tiers` returns one
 * row per live subscription, so two live subscriptions to the SAME plan would
 * be counted twice. Stacking is one-of-each by rule, not by constraint.
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

/* --- the ladder ----------------------------------------------------------
 * Plays a week, by plan. The free plan is not listed: it grants none and that
 * is deliberate — the hub shows an upgrade rather than a game to an account
 * with an allowance of zero.
 */
const PLAYS = [
  { slug: 'bronze', plays: 1 },
  { slug: 'silver', plays: 2 },
  { slug: 'pearl', plays: 3 },
  { slug: 'gold', plays: 4 },
  { slug: 'sapphire', plays: 5 },
  { slug: 'platinum', plays: 6 },
]

const MODE = 'sum_bonus'

/* --- the rule ------------------------------------------------------------
 * Read every plan in price order. Paying more must buy MORE plays, never the
 * same number and never fewer. This is the games half of the rule
 * `apply-plan-ladder.mjs` enforces for points an ad, and it is the one that
 * was broken: Pearl and Silver both granted 2.
 */
function faultsIn(rungs) {
  const faults = []
  for (let i = 1; i < rungs.length; i += 1) {
    const below = rungs[i - 1]
    const above = rungs[i]
    if (above.plays <= below.plays) {
      faults.push(
        `${below.slug} (GHS ${below.priceGhs}) grants ${below.plays} and ` +
          `${above.slug} (GHS ${above.priceGhs}) grants ${above.plays}: more money, not more plays`,
      )
    }
  }
  return faults
}

/** What somebody holding every plan up to and including `slug` would draw. */
function stacked(rungs, mode, freePlays) {
  const totals = []
  let sum = freePlays
  for (const r of rungs) {
    sum += Math.max(r.plays - freePlays, 0)
    totals.push({
      slug: r.slug,
      total: mode === 'sum_bonus' ? sum : Math.max(freePlays, ...rungs.slice(0, totals.length + 1).map((x) => x.plays)),
    })
  }
  return totals
}

function table(title, rungs, mode, freePlays, sellable) {
  console.log(`\n${title}  (mode ${mode}, free plan ${freePlays})`)
  console.log('  plan        price      plays   holding this and everything below')
  for (const t of stacked(rungs, mode, freePlays)) {
    const r = rungs.find((x) => x.slug === t.slug)
    console.log(
      '  ' + r.slug.padEnd(11),
      String(r.priceGhs).padStart(6),
      String(r.plays).padStart(7),
      '  ' + String(t.total).padStart(4),
      sellable.includes(r.slug) ? '' : '   (announced, not on sale)',
    )
  }
}

/* --- run ----------------------------------------------------------------- */
const { data: rows, error: readError } = await db
  .from('tiers')
  .select('id, slug, name, price_minor, weekly_game_plays, is_default, is_active, coming_soon')
  .order('sort_order')

if (readError) {
  console.error('Could not read the plans:', readError.message)
  process.exit(1)
}

const { data: configRows } = await db
  .from('app_config')
  .select('key, value')
  .in('key', ['game_plays_combine_mode', 'games_enabled'])

const mode = configRows?.find((c) => c.key === 'game_plays_combine_mode')?.value ?? 'highest'
const gamesOn = configRows?.find((c) => c.key === 'games_enabled')?.value === 'true'

const free = rows.find((r) => r.is_default)
const freePlays = free?.weekly_game_plays ?? 0
const paid = rows.filter((r) => !r.is_default && r.is_active)
const sellable = paid.filter((r) => !r.coming_soon).map((r) => r.slug)

console.log(`project ${url}`)
console.log(`games are currently ${gamesOn ? 'ON' : 'OFF'}, combine mode ${mode}`)
console.log(`on sale: ${sellable.join(', ')}`)

const before = PLAYS.map((w) => {
  const row = paid.find((p) => p.slug === w.slug)
  return row ? { slug: row.slug, priceGhs: row.price_minor / 100, plays: row.weekly_game_plays } : null
}).filter(Boolean)

const after = PLAYS.map((w) => {
  const row = paid.find((p) => p.slug === w.slug)
  return row ? { slug: w.slug, priceGhs: row.price_minor / 100, plays: w.plays } : null
}).filter(Boolean)

const missing = PLAYS.filter((w) => !paid.some((p) => p.slug === w.slug))
if (missing.length) {
  console.error('\nNo such plan: ' + missing.map((m) => m.slug).join(', '))
  process.exit(1)
}

table('NOW', before, mode, freePlays, sellable)
table('PROPOSED', after, MODE, freePlays, sellable)

console.log('\nmore money must buy more plays, at every step:')
const faults = faultsIn(after)
if (faults.length) {
  for (const f of faults) console.log('  BREAKS  ' + f)
  console.error('\nRefusing to apply a ladder that charges more for the same plays.')
  process.exit(1)
}
console.log('  clean at all ' + (after.length - 1) + ' steps')

/* What this actually costs, stated in plays rather than left to be discovered
   once the games are on. */
const wasTop = Math.max(freePlays, ...before.filter((r) => sellable.includes(r.slug)).map((r) => r.plays))
const nowTop = stacked(after, MODE, freePlays).filter((t) => sellable.includes(t.slug)).pop()?.total ?? freePlays
console.log(`\nmost plays a paying member can hold: ${wasTop} a week -> ${nowTop} a week`)
console.log('  every face pays something, so that is the per-member prize liability multiplier')

if (!apply) {
  console.log('\nNothing written. Re-run with --apply to save it.')
  process.exit(0)
}

/* The admin whose name goes on the audit row. Super admin: both
   `admin_set_tier_game_plays` and `admin_set_config` call `assert_admin`,
   which refuses everybody else. */
const { data: admins, error: roleError } = await db
  .from('user_roles')
  .select('user_id')
  .eq('role', 'super_admin')
  .limit(1)

if (roleError || !admins?.length) {
  console.error('No super admin to act as:', roleError?.message ?? 'none found')
  process.exit(1)
}
const adminId = admins[0].user_id

console.log(`\nsaving as super admin ${adminId}, top of the ladder first`)

for (const want of [...PLAYS].reverse()) {
  const row = paid.find((p) => p.slug === want.slug)
  const { error } = await db.rpc('admin_set_tier_game_plays', {
    p_admin_id: adminId,
    p_tier_id: row.id,
    p_plays: want.plays,
  })
  if (error) {
    console.error(`  ${want.slug}: FAILED ${error.message}`)
    console.error('  Stopping here. The mode is untouched, so nothing stacks on a half-saved ladder.')
    process.exit(1)
  }
  console.log(`  ${want.slug}: ${want.plays} a week`)
}

/* LAST, and only once every rung is right. */
const { error: modeError } = await db.rpc('admin_set_config', {
  p_admin_id: adminId,
  p_values: { game_plays_combine_mode: MODE },
})
if (modeError) {
  console.error(`  combine mode: FAILED ${modeError.message}`)
  console.error('  The ladder is saved. Plays still take the best single plan until this is set.')
  process.exit(1)
}
console.log(`  combine mode: ${MODE}`)

/* --- read it back --------------------------------------------------------
   Not a formality. `admin_set_config` validates against
   `admin_config_allowed_values` and returns only the settings that MOVED, so
   a value it quietly declined would otherwise look like a success here. */
const { data: saved } = await db
  .from('tiers')
  .select('slug, price_minor, weekly_game_plays, coming_soon')
  .eq('is_active', true)
  .order('sort_order')

const { data: savedMode } = await db
  .from('app_config')
  .select('value')
  .eq('key', 'game_plays_combine_mode')
  .maybeSingle()

console.log('\nread back from the database:')
for (const r of saved.filter((s) => PLAYS.some((p) => p.slug === s.slug))) {
  const want = PLAYS.find((p) => p.slug === r.slug)
  const ok = r.weekly_game_plays === want.plays
  console.log(`  ${r.slug.padEnd(11)} ${String(r.weekly_game_plays).padStart(2)} a week  ${ok ? '' : 'MISMATCH, wanted ' + want.plays}`)
}
console.log(`  combine mode ${savedMode?.value}${savedMode?.value === MODE ? '' : '  MISMATCH, wanted ' + MODE}`)
