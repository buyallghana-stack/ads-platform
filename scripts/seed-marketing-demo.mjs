/**
 * Marketing Demo Account Seed Script
 *
 * Seeds a genuine demo account for:
 *   Name: Jones
 *   Plan: Platinum (13 daily ads cap)
 *   Balance: GHS 3,369.25 (336,925 points)
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-marketing-demo.mjs
 *   node --env-file=.env.local scripts/seed-marketing-demo.mjs --drop
 */
import { createClient } from '@supabase/supabase-js'

const EMAIL = 'jones@demo.invalid'
const PASSWORD = 'Marketing!2026'
const NAME = 'Jones'
const POINTS_BALANCE = 336_925 // GHS 3,369.25 at 100 points per Cedi

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const drop = process.argv.includes('--drop')

async function purge(targetEmail) {
  const { data: users } = await sb.auth.admin.listUsers()
  const user = users?.users?.find((u) => u.email === targetEmail)
  if (!user) return

  const userId = user.id
  console.log(`Purging demo user ${targetEmail} (${userId})...`)

  // Delete associated user data
  await sb.from('ad_attempts').delete().eq('user_id', userId)
  await sb.from('ad_completions').delete().eq('user_id', userId)
  await sb.from('user_tasks').delete().eq('user_id', userId)
  await sb.from('notifications').delete().eq('user_id', userId)
  await sb.from('fraud_signals').delete().eq('user_id', userId)
  await sb.from('redemptions').delete().eq('user_id', userId)
  await sb.from('points_ledger').delete().eq('user_id', userId)
  await sb.from('user_subscriptions').delete().eq('user_id', userId)
  await sb.from('user_balances').delete().eq('user_id', userId)
  await sb.from('profiles').delete().eq('id', userId)
  await sb.auth.admin.deleteUser(userId)
  console.log(`Deleted user ${targetEmail}`)
}

async function main() {
  await purge(EMAIL)
  await purge('george@demo.invalid')
  await purge('buyer@demo.invalid')

  if (drop) {
    console.log('Cleanup complete.')
    process.exit(0)
  }

  // 1. Create the user in Auth
  console.log(`Creating user ${EMAIL}...`)
  const { data: authData, error: authError } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: NAME, first_name: NAME },
  })

  if (authError) {
    console.error('Error creating user:', authError)
    process.exit(1)
  }

  const userId = authData.user.id
  console.log(`Created user ${NAME} with ID: ${userId}`)

  // 2. Fetch Platinum tier (13 ads cap)
  const { data: tiers, error: tierError } = await sb
    .from('tiers')
    .select('id, slug, daily_ad_cap, name')
    .eq('slug', 'platinum')
    .single()

  if (tierError || !tiers) {
    console.error('Error fetching platinum tier:', tierError)
    process.exit(1)
  }

  // 3. Create active subscription
  await sb.from('user_subscriptions').insert({
    user_id: userId,
    tier_id: tiers.id,
    status: 'active',
    started_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    current_period_end: new Date(Date.now() + 45 * 86400000).toISOString(),
  })

  // 4. Update profile
  await sb.from('profiles').upsert({
    id: userId,
    full_name: NAME,
    email: EMAIL,
    phone: '+233240000000',
    onboarding_completed: true,
    country_code: 'GH',
  })

  // 5. Credit Points Balance (GHS 3,369.25 = 336,925 points)
  // We credit points via points_ledger
  await sb.from('points_ledger').insert([
    {
      user_id: userId,
      entry_type: 'credit',
      reason: 'ad_completion',
      amount: 250_000,
      idempotency_key: `demo-ad-credits-${userId}`,
      created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    },
    {
      user_id: userId,
      entry_type: 'credit',
      reason: 'referral_bonus',
      amount: 50_000,
      idempotency_key: `demo-referral-credits-${userId}`,
      created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    },
    {
      user_id: userId,
      entry_type: 'credit',
      reason: 'task_completion',
      amount: 36_925,
      idempotency_key: `demo-task-credits-${userId}`,
      created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    },
  ])

  // Update user_balances
  await sb.from('user_balances').upsert({
    user_id: userId,
    balance: POINTS_BALANCE,
    lifetime_earned: POINTS_BALANCE,
    updated_at: new Date().toISOString(),
  })

  console.log(`\nSuccessfully seeded Jones:`)
  console.log(`  Email:      ${EMAIL}`)
  console.log(`  Password:   ${PASSWORD}`)
  console.log(`  Plan:       Platinum (${tiers.daily_ad_cap} daily ads)`)
  console.log(`  Balance:    GHS ${(POINTS_BALANCE / 100).toFixed(2)} (${POINTS_BALANCE.toLocaleString()} points)`)
}

main().catch((err) => {
  console.error('Failed to seed demo user:', err)
  process.exit(1)
})
