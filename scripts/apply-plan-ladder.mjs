/**
 * Retune the price ladder, through the admin function rather than a migration.
 *
 *   node scripts/apply-plan-ladder.mjs           check only, writes nothing
 *   node scripts/apply-plan-ladder.mjs --apply   save it
 *
 * WHY THIS IS NOT A MIGRATION. Pricing is an operator decision that changes
 * more than once, and `admin_save_plan` is the path the admin screen uses. A
 * migration would put the same numbers in a file that replays on every fresh
 * database and then disagrees with whatever the operator did next. This calls
 * the same function the panel calls, with the same payload, so the ladder has
 * exactly one way in.
 *
 * THE RULE IT ENFORCES. Read every price a buyer can pay, in order, across all
 * six bands. At no point may paying MORE buy less: not fewer points an ad, not
 * a lower return, not a longer wait to break even. The bands have gaps between
 * them precisely so that holds, and the check below is the thing that proves
 * it rather than the table looking reasonable.
 *
 * ⚠️ TOP DOWN, PLATINUM FIRST. `resolve_user_tier` recomputes a member's rate
 * from `plan_multiplier_for_amount` on EVERY ad, so a half finished run is
 * live. Every new rate here is above the old one, so saving from the top keeps
 * the ladder monotone at every intermediate state. Bottom up would leave
 * Bronze's new ceiling sitting above Silver's old floor for as long as the
 * next save takes.
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
 * Operator, 2026-09-19. Lengths spread 39 to 57 days and the return climbs
 * 2.00x to 3.00x, against the flat 25 day payback and 2.00x to 2.20x the
 * ladder carried since 2026-08-12.
 *
 * EVERY RATE IS TWO DECIMALS ON PURPOSE. An ad pays `floor(base_ad_points x
 * rate)` and the base is 100, so a two decimal rate pays exactly 100 times
 * itself with nothing lost to rounding between what the card quotes and what
 * the ledger credits. Three decimals would quietly shave the last point off
 * at some prices and not others.
 */
const LADDER = [
  { slug: 'bronze', priceGhs: 85, bandMaxGhs: 105, rewardMultiplier: 1.45, bandMaxMultiplier: 1.8, dailyAdCap: 3, billingPeriodDays: 39 },
  { slug: 'silver', priceGhs: 145, bandMaxGhs: 180, rewardMultiplier: 1.87, bandMaxMultiplier: 2.33, dailyAdCap: 4, billingPeriodDays: 43 },
  { slug: 'pearl', priceGhs: 230, bandMaxGhs: 285, rewardMultiplier: 2.39, bandMaxMultiplier: 2.97, dailyAdCap: 5, billingPeriodDays: 46 },
  { slug: 'gold', priceGhs: 400, bandMaxGhs: 500, rewardMultiplier: 2.98, bandMaxMultiplier: 3.73, dailyAdCap: 7, billingPeriodDays: 50 },
  { slug: 'sapphire', priceGhs: 720, bandMaxGhs: 900, rewardMultiplier: 3.78, bandMaxMultiplier: 4.73, dailyAdCap: 10, billingPeriodDays: 53 },
  { slug: 'platinum', priceGhs: 1180, bandMaxGhs: 1500, rewardMultiplier: 4.78, bandMaxMultiplier: 6.08, dailyAdCap: 13, billingPeriodDays: 57 },
]

/* --- the rule ------------------------------------------------------------
 * Twelve prices, in order: each band's floor and its ceiling. Points an ad
 * must rise at every step, and neither the return nor the payback may move
 * the wrong way. `pointsPerAd` is `src/lib/subscriptions/pricing.ts` and
 * `credit_ad_points` rounding, written out rather than imported so this runs
 * on plain node.
 */
const pointsPerAd = (base, rate) => Math.max(Math.floor(base * rate), 1)

function sweep(rungs, base) {
  const points = []
  for (const r of rungs) {
    const at = (price, rate) => ({
      label: `${r.slug} ${price === r.priceGhs ? 'floor' : 'ceiling'}`,
      priceGhs: price,
      perAd: pointsPerAd(base, rate),
    })
    for (const p of [at(r.priceGhs, r.rewardMultiplier), at(r.bandMaxGhs, r.bandMaxMultiplier)]) {
      p.multiple = (r.billingPeriodDays * r.dailyAdCap * p.perAd) / (p.priceGhs * 100)
      p.paybackDays = (p.priceGhs * 100) / (r.dailyAdCap * p.perAd)
      points.push(p)
    }
  }

  const faults = []
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const said = []
    if (b.perAd <= a.perAd) said.push(`points an ad ${a.perAd} to ${b.perAd}`)
    if (b.multiple < a.multiple - 1e-9) said.push(`return ${a.multiple.toFixed(3)}x to ${b.multiple.toFixed(3)}x`)
    if (b.paybackDays > a.paybackDays + 1e-9) {
      said.push(`payback ${a.paybackDays.toFixed(2)}d to ${b.paybackDays.toFixed(2)}d`)
    }
    if (said.length) faults.push(`GHS ${a.priceGhs} (${a.label}) to GHS ${b.priceGhs} (${b.label}): ${said.join(', ')}`)
  }
  return { points, faults }
}

function table(title, rungs, base) {
  const { points } = sweep(rungs, base)
  console.log(`\n${title}`)
  console.log('  plan       price        ads  days   points an ad   rate            return        payback')
  rungs.forEach((r, i) => {
    const lo = points[i * 2]
    const hi = points[i * 2 + 1]
    console.log(
      '  ' + r.slug.padEnd(10),
      `${r.priceGhs}-${r.bandMaxGhs}`.padEnd(12),
      String(r.dailyAdCap).padStart(3),
      String(r.billingPeriodDays).padStart(5),
      `   ${lo.perAd} to ${hi.perAd}`.padEnd(15),
      `${r.rewardMultiplier} to ${r.bandMaxMultiplier}`.padEnd(15),
      `${lo.multiple.toFixed(2)}x to ${hi.multiple.toFixed(2)}x`.padEnd(13),
      `${lo.paybackDays.toFixed(1)}d to ${hi.paybackDays.toFixed(1)}d`,
    )
  })
}

/* --- run ----------------------------------------------------------------- */
const { data: config } = await db.from('app_config').select('key, value').in('key', ['subscription_max_combined_multiplier'])
const { data: priv } = await db.rpc('admin_config_value', { p_key: 'base_ad_points' }).then(
  (r) => (r.error ? { data: null } : r),
  () => ({ data: null }),
)
const base = Number(priv) || 100
const ceiling = Number(config?.find((c) => c.key === 'subscription_max_combined_multiplier')?.value ?? 0)

const { data: rows, error: readError } = await db
  .from('tiers')
  .select('id, slug, name, description, price_minor, band_max_minor, reward_multiplier, band_max_multiplier, daily_ad_cap, billing_period_days, redemption_minimum_points, referral_bonus_multiplier, ad_priority, ad_cooldown_seconds, sort_order, is_active, is_default, coming_soon')
  .order('sort_order')

if (readError) {
  console.error('Could not read the plans:', readError.message)
  process.exit(1)
}

const paid = rows.filter((r) => !r.is_default && r.is_active)
const before = paid.map((r) => ({
  slug: r.slug,
  priceGhs: r.price_minor / 100,
  bandMaxGhs: r.band_max_minor === null ? r.price_minor / 100 : r.band_max_minor / 100,
  rewardMultiplier: Number(r.reward_multiplier),
  bandMaxMultiplier: Number(r.band_max_multiplier ?? r.reward_multiplier),
  dailyAdCap: r.daily_ad_cap,
  billingPeriodDays: r.billing_period_days,
}))

console.log(`project ${url}`)
console.log(`base points an ad ${base}, combined rate ceiling ${ceiling}`)

/* ANNOUNCED IS NOT ON SALE. A `coming_soon` rung keeps its band, because the
   rung below it is priced against it, so the ladder below is retuned exactly
   the same way. It is called out because the return the ladder offers is not
   the return a visitor can buy today: with the top rungs closed the front page
   quotes the best OPEN plan, not the best plan. */
const announced = paid.filter((p) => p.coming_soon).map((p) => p.slug)
if (announced.length) {
  console.log(`announced but NOT on sale: ${announced.join(', ')}`)
  console.log('  their bands are still retuned, and the front page will not quote them')
}
table('NOW', before, base)
table('PROPOSED', LADDER, base)

const check = sweep(LADDER, base)
console.log('\nmore is better, across all twelve prices a buyer can pay:')
if (check.faults.length) {
  for (const f of check.faults) console.log('  BREAKS  ' + f)
  console.error('\nRefusing to apply a ladder that pays less for more.')
  process.exit(1)
}
console.log('  clean at all eleven steps')
console.log('  points an ad: ' + check.points.map((p) => p.perAd).join(' < '))

const top = Math.max(...LADDER.map((r) => r.bandMaxMultiplier))
if (ceiling > 0 && top > ceiling) {
  console.error(`\nsubscription_max_combined_multiplier is ${ceiling}, below the top of this ladder (${top}).`)
  console.error('Every member on the top plan would be paid less than the card promises. Raise it first.')
  process.exit(1)
}
console.log(`  top rate ${top} against the ${ceiling} combined ceiling: clear`)

const missing = LADDER.filter((r) => !paid.some((p) => p.slug === r.slug))
if (missing.length) {
  console.error('\nNo such plan: ' + missing.map((m) => m.slug).join(', '))
  process.exit(1)
}

if (!apply) {
  console.log('\nNothing written. Re-run with --apply to save it.')
  process.exit(0)
}

/* The admin whose name goes on the audit row. Super admin, because
   `admin_save_plan` calls `assert_admin` and that refuses everybody else. */
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

for (const want of [...LADDER].reverse()) {
  const row = paid.find((p) => p.slug === want.slug)
  const { error } = await db.rpc('admin_save_plan', {
    p_admin_id: adminId,
    p_plan: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      /* SENT, NOT OMITTED. `admin_save_plan` reads description through
         `nullif(trim(coalesce(...,'')),'')` with no fallback to the stored
         value, so leaving it out erases the plan's description. */
      description: row.description ?? '',
      priceGhs: want.priceGhs,
      billingPeriodDays: want.billingPeriodDays,
      dailyAdCap: want.dailyAdCap,
      rewardMultiplier: want.rewardMultiplier,
      redemptionMinimumPoints: Number(row.redemption_minimum_points),
      referralBonusMultiplier: Number(row.referral_bonus_multiplier),
      adPriority: row.ad_priority,
      adCooldownSeconds: row.ad_cooldown_seconds,
      sortOrder: row.sort_order,
      bandMaxGhs: want.bandMaxGhs,
      bandMaxMultiplier: want.bandMaxMultiplier,
      /* `comingSoon` IS DELIBERATELY NOT SENT. `admin_save_plan` sets it only
         when the key is present, so leaving it out keeps whatever the operator
         decided. Sending `false` here would quietly put an announced plan on
         sale as a side effect of a price change. */
    },
  })
  if (error) {
    console.error(`  ${want.slug}: FAILED ${error.message}`)
    console.error('  Stopping here. The plans above this one are already saved and are still monotone.')
    process.exit(1)
  }
  console.log(`  ${want.slug}: saved`)
}

/* --- read it back -------------------------------------------------------- */
const { data: after } = await db
  .from('tiers')
  .select('slug, price_minor, band_max_minor, reward_multiplier, band_max_multiplier, daily_ad_cap, billing_period_days, is_default, is_active')
  .order('sort_order')

const stored = after
  .filter((r) => !r.is_default && r.is_active)
  .map((r) => ({
    slug: r.slug,
    priceGhs: r.price_minor / 100,
    bandMaxGhs: r.band_max_minor / 100,
    rewardMultiplier: Number(r.reward_multiplier),
    bandMaxMultiplier: Number(r.band_max_multiplier),
    dailyAdCap: r.daily_ad_cap,
    billingPeriodDays: r.billing_period_days,
  }))

table('STORED', stored, base)
const proof = sweep(stored, base)
console.log('\nread back from the database:')
if (proof.faults.length) {
  for (const f of proof.faults) console.log('  BREAKS  ' + f)
  process.exit(1)
}
console.log('  clean at all eleven steps')

/* The rate the database will actually pay at each end of each band, asked of
   the function that decides it rather than recomputed here. Two places
   implement this rule and they are meant to agree. */
console.log('\nwhat plan_multiplier_for_amount pays at each end:')
for (const r of stored) {
  for (const [price, want] of [[r.priceGhs, r.rewardMultiplier], [r.bandMaxGhs, r.bandMaxMultiplier]]) {
    const { data: got } = await db.rpc('plan_multiplier_for_amount', { p_minor: Math.round(price * 100) })
    const ok = Math.abs(Number(got) - want) < 1e-9
    console.log(`  GHS ${String(price).padStart(5)}  ${String(got).padEnd(7)} ${ok ? 'as priced' : `MISMATCH, card says ${want}`}`)
  }
}
