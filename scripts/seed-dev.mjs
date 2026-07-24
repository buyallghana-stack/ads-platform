/**
 * Development seed — TEMPORARY, DELETE BEFORE PRODUCTION.
 *
 *   pnpm seed        create/reset the demo accounts and sample ads
 *   pnpm seed --drop remove everything this script created, and nothing else
 *
 * Exists so the admin and user surfaces can be exercised end to end while
 * transactional email is still unwired. Both accounts are created with
 * `email_confirm: true`, which marks the address verified server-side without
 * an email ever being sent — so the OTP step is skipped entirely and these
 * accounts can log straight in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE MUST NOT REACH PRODUCTION
 *
 * It writes known-password accounts, one of which is a full admin. It refuses
 * to run against a non-local NEXT_PUBLIC_SITE_URL unless SEED_I_MEAN_IT=1 is
 * set, but that guard is a seatbelt, not a lock. Delete the file, the pnpm
 * script, and the accounts before go-live — it is on the pre-production
 * checklist (§10) for exactly that reason.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

/* --- env ---------------------------------------------------------------- */
// Read .env.local directly: this is a plain node script, so it does not get
// Next.js's automatic env loading.
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''

if (!url || !secret) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local')
  process.exit(1)
}

const isLocal = siteUrl.includes('localhost') || siteUrl.includes('127.0.0.1')
if (!isLocal && process.env.SEED_I_MEAN_IT !== '1') {
  console.error(
    `Refusing to seed: NEXT_PUBLIC_SITE_URL is "${siteUrl}", which is not local.\n` +
      'This script creates accounts with known passwords, including an admin.\n' +
      'If you genuinely mean to run it here, set SEED_I_MEAN_IT=1.',
  )
  process.exit(1)
}

const db = createClient(url, secret, { auth: { persistSession: false } })
const drop = process.argv.includes('--drop')

/* --- what gets created --------------------------------------------------- */

const PASSWORD = '1234'

const ACCOUNTS = [
  {
    email: 'admin@email.com',
    role: 'admin',
    fullName: 'Demo Admin',
    phone: '0240000001',
  },
  {
    email: 'user@email.com',
    role: 'user',
    fullName: 'Demo User',
    phone: '0240000002',
  },
]

/**
 * Sample ads so the earning loop has something to serve. One of each format
 * and question type, because those are the branches worth clicking through:
 * a YouTube video with a multiple-choice question, an uploaded-URL video with
 * a short-text answer, and a survey.
 */
const ADS = [
  {
    ad: {
      title: 'MTN 4G data bundles',
      description: 'Sample seeded ad — a YouTube-hosted video with a multiple-choice question.',
      advertiser_name: 'MTN Ghana',
      format: 'video',
      points_reward: 50,
      video_source: 'youtube',
      // The 11-char id, not a full URL — the column stores the id.
      youtube_video_id: 'aqz-KE-bpKQ',
      duration_seconds: 60,
      min_watch_seconds: 15,
      max_completions: 500,
    },
    question: {
      question_text: 'Which network was advertised?',
      answer_format: 'multiple_choice',
      options: [
        { option_text: 'MTN', is_correct: true },
        { option_text: 'Telecel', is_correct: false },
        { option_text: 'AirtelTigo', is_correct: false },
        { option_text: 'Glo', is_correct: false },
      ],
    },
  },
  {
    ad: {
      title: 'Fresh produce, delivered',
      description: 'Sample seeded ad — an uploaded video with a short-text answer.',
      advertiser_name: 'AccraFresh',
      format: 'video',
      points_reward: 35,
      video_source: 'upload',
      // Storage object path. Nothing is uploaded here: the row exercises the
      // upload branch of the schema and the admin editor. The player will not
      // resolve it until a real object exists at this path.
      storage_path: 'seed/accrafresh-sample.mp4',
      duration_seconds: 30,
      min_watch_seconds: 10,
      max_completions: 500,
    },
    question: {
      question_text: 'Type the name of the company in the advert.',
      answer_format: 'short_text',
      correct_answer: 'AccraFresh',
    },
  },
  {
    ad: {
      title: 'How do you pay for things?',
      description: 'Sample seeded survey — no video, question only.',
      advertiser_name: 'AdReward Research',
      format: 'survey',
      points_reward: 80,
      max_completions: 500,
    },
    question: {
      question_text: 'Which do you use most often to pay?',
      answer_format: 'multiple_choice',
      options: [
        { option_text: 'Mobile money', is_correct: true },
        { option_text: 'Bank card', is_correct: false },
        { option_text: 'Cash', is_correct: false },
        { option_text: 'Crypto', is_correct: false },
      ],
    },
  },
]

const SEED_ADVERTISERS = [...new Set(ADS.map((entry) => entry.ad.advertiser_name))]

/* --- helpers ------------------------------------------------------------- */

/** Find an auth user by email. listUsers is paginated; these are page one. */
async function findUser(email) {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null
}

async function removeSeed() {
  for (const account of ACCOUNTS) {
    const existing = await findUser(account.email)
    if (existing) {
      // Cascades to profiles, roles and every other user-scoped row — EXCEPT
      // the points ledger, which is RESTRICT by design (migration 007): an
      // account with financial history cannot be hard-deleted. When that
      // bites, keep the account and its history; the run below skips
      // re-seeding history it finds already present. Full purge stays the
      // documented owner-only SQL recipe in migration 007.
      const { error } = await db.auth.admin.deleteUser(existing.id)
      if (error) {
        account.reuseId = existing.id
        console.log(`  keeping ${account.email} (has ledger history; delete is blocked by design)`)
      } else {
        console.log(`  removed account ${account.email}`)
      }
    }
  }

  // Scoped to this script's advertiser labels so a real ad entered through the
  // dashboard is never caught by --drop.
  const { data: removed, error } = await db
    .from('ads')
    .delete()
    .in('advertiser_name', SEED_ADVERTISERS)
    .select('id')
  if (error) throw error
  if (removed?.length) console.log(`  removed ${removed.length} sample ad(s)`)
}

/* --- run ----------------------------------------------------------------- */

console.log(drop ? 'Removing seed data…' : 'Seeding development data…')
console.log(`  project: ${url}\n`)

await removeSeed()

if (drop) {
  console.log('\nDone. Seed data removed.')
  process.exit(0)
}

/* Accounts. */
const created = {}
for (const account of ACCOUNTS) {
  if (account.reuseId) {
    created[account.role] = account.reuseId
    console.log(`  reusing ${account.email}`)
    continue
  }
  const { data, error } = await db.auth.admin.createUser({
    email: account.email,
    password: PASSWORD,
    // The whole point: marks the address verified without sending anything,
    // so these accounts skip the OTP screen that email cannot yet reach.
    email_confirm: true,
    user_metadata: {
      full_name: account.fullName,
      phone: account.phone,
      signup_country: 'GH',
    },
  })

  if (error) {
    console.error(`  FAILED ${account.email}: ${error.message}`)
    if (/password/i.test(error.message)) {
      console.error(
        '\n  Supabase enforces a minimum password length on the project.\n' +
          '  Lower it at: Authentication > Sign In / Providers > Minimum password length.\n',
      )
    }
    process.exit(1)
  }

  created[account.role] = data.user.id
  console.log(`  created ${account.email}`)

  // handle_new_user already granted 'user'; promote where the account is meant
  // to be an admin. Deliberately an explicit grant, matching how a real admin
  // is made — there is no path that mints an admin implicitly.
  if (account.role === 'admin') {
    const { error: roleError } = await db
      .from('user_roles')
      .update({ role: 'admin' })
      .eq('user_id', data.user.id)
    if (roleError) throw roleError
    console.log(`         promoted to admin`)
  }
}

/* Sample ads. */
for (const { ad, question } of ADS) {
  const { data: inserted, error } = await db
    .from('ads')
    .insert({ ...ad, status: 'active', created_by: created.admin })
    .select('id')
    .single()
  if (error) throw error

  const { options, ...questionRow } = question
  const { data: q, error: questionError } = await db
    .from('ad_questions')
    .insert({ ...questionRow, ad_id: inserted.id, position: 0 })
    .select('id')
    .single()
  if (questionError) throw questionError

  if (options) {
    const { error: optionError } = await db.from('ad_question_options').insert(
      options.map((option, index) => ({ ...option, question_id: q.id, sort_order: index })),
    )
    if (optionError) throw optionError
  }

  console.log(`  created ad "${ad.title}"`)
}

/* --- demo transaction history (user account) ------------------------------
 *
 * Backdated rows so the Home tab's chart and statement have something real
 * to render. Direct inserts rather than credit_points/debit_points because
 * those functions stamp now() and cannot backdate; the append-only trigger
 * permits INSERT, and user_balances is upserted below to stay consistent
 * with the rows (same guarantee the functions provide, done by hand).
 * Dev-only, removed wholesale by --drop via the account cascade.
 */
{
  // Idempotence: a reused account already carries seeded history — adding a
  // second copy would double every balance, so detect and skip.
  const { data: existingSeed } = await db
    .from('points_ledger')
    .select('id')
    .eq('user_id', created.user)
    .limit(1)
  if (existingSeed?.length) {
    console.log('  ledger history already present — skipping history seed')
  } else {
  const RATE = 1000 // points per GHS, matching the seeded config
  const DAY = 24 * 60 * 60 * 1000
  const events = []

  const at = (daysAgo, hour) => {
    const d = new Date(Date.now() - daysAgo * DAY)
    d.setUTCHours(hour, Math.floor(Math.random() * 55), 0, 0)
    return d
  }
  const push = (daysAgo, hour, entry_type, amount, extra = {}) =>
    events.push({ when: at(daysAgo, hour), entry_type, amount, extra })

  // Three weeks of ad watching, quieter at the start, busier lately.
  for (let daysAgo = 21; daysAgo >= 0; daysAgo--) {
    const views = daysAgo > 14 ? 1 + (daysAgo % 3) : daysAgo > 7 ? 3 + (daysAgo % 3) : 4 + (daysAgo % 4)
    for (let v = 0; v < views; v++) {
      const reward = [50, 50, 35, 80][v % 4]
      push(daysAgo, 8 + v * 2, 'ad_view', reward, {
        reference_type: 'ad',
        reference_id: `seed-ad-${daysAgo}-${v}`,
      })
    }
  }
  // A referral converting, then activating.
  push(12, 19, 'referral_signup', 200, { reference_type: 'referral', reference_id: 'seed-ref-1' })
  push(5, 20, 'referral_activation', 800, { reference_type: 'referral', reference_id: 'seed-ref-1' })
  // One payout request.
  push(3, 17, 'redemption_request', -2000, {
    reference_type: 'redemption',
    reference_id: '00000000-0000-4000-8000-00000000feed',
  })

  // balance_after must follow TIME order, not push order — otherwise the
  // statement's running balance contradicts itself around the withdrawal.
  events.sort((a, b) => a.when - b.when)
  let balance = 0
  let lifetimeEarned = 0
  let lifetimeSpent = 0
  const rows = events.map((e) => {
    balance += e.amount
    if (e.amount > 0) lifetimeEarned += e.amount
    else lifetimeSpent += -e.amount
    return {
      user_id: created.user,
      entry_type: e.entry_type,
      amount: e.amount,
      balance_after: balance,
      points_per_currency_unit: RATE,
      metadata: { seed: true },
      created_at: e.when.toISOString(),
      ...e.extra,
    }
  })

  const { error: ledgerError } = await db.from('points_ledger').insert(rows)
  if (ledgerError) throw ledgerError

  const { error: balanceError } = await db.from('user_balances').upsert({
    user_id: created.user,
    balance,
    lifetime_earned: lifetimeEarned,
    lifetime_spent: lifetimeSpent,
  })
  if (balanceError) throw balanceError
  console.log(`  seeded ${rows.length} ledger entries for user@email.com (balance ${balance})`)

  // One confirmed plan payment, if a paid tier exists to hang it on.
  const { data: paidTier } = await db
    .from('tiers')
    .select('id, price_minor')
    .gt('price_minor', 0)
    .order('price_minor')
    .limit(1)
    .maybeSingle()
  if (paidTier) {
    const paidAt = new Date(Date.now() - 6 * DAY).toISOString()
    const { error: subError } = await db.from('subscription_payments').insert({
      user_id: created.user,
      tier_id: paidTier.id,
      method: 'korapay',
      status: 'confirmed',
      amount_minor: paidTier.price_minor,
      period_days: 30,
      external_reference: 'seed-sub-1',
      created_at: paidAt,
      confirmed_at: paidAt,
    })
    if (subError) throw subError
    console.log(`  seeded 1 confirmed subscription payment`)
  }
  } // end history seed (skipped when already present)
}

console.log(`
Done.

  admin@email.com / ${PASSWORD}   → admin dashboard
  user@email.com  / ${PASSWORD}   → user dashboard

Both addresses are pre-verified, so log in directly — there is no OTP step.
Remove everything with: pnpm seed --drop
`)
