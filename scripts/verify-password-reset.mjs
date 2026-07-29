/**
 * End-to-end check of the password reset flow, against a real recovery link.
 *
 * Uses a THROWAWAY account it creates and deletes itself. Never the demo
 * accounts: user@email.com carries the operator's real authenticator, and
 * admin@email.com has real Paystack purchases behind it.
 *
 *   BASE=http://localhost:3100 node scripts/verify-password-reset.mjs
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SECRET_KEY

if (!URL || !KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required')
  process.exit(1)
}

const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const stamp = Date.now()
const EMAIL = `reset-check-${stamp}@test.invalid`
const OLD_PASSWORD = `OldPassw0rd!${stamp}`
const NEW_PASSWORD = `NewPassw0rd!${stamp}`

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

let userId = null
let browser = null

try {
  // ---- A confirmed account, the way a real signed-up user looks -----------
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: OLD_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Reset Check' },
  })
  if (createError) throw createError
  userId = created.user.id
  console.log(`fixture user ${EMAIL}`)

  // ---- The real recovery link, minted the way the mail would carry it -----
  // generateLink returns the same token_hash the email template interpolates,
  // so this exercises the genuine /auth/confirm redemption, not a shortcut.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: EMAIL,
    options: { redirectTo: `${BASE}/auth/confirm?next=/reset-password` },
  })
  if (linkError) throw linkError

  const confirmUrl =
    `${BASE}/auth/confirm?token_hash=${link.properties.hashed_token}` +
    `&type=recovery&next=%2Freset-password`

  /*
    A session that existed BEFORE the reset — this stands in for the attacker
    who is already signed in, which is the situation a reset exists to end.
    Taken before the reset so its refresh token is genuinely older.
  */
  const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: priorLogin } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: OLD_PASSWORD,
  })
  const priorRefresh = priorLogin?.session?.refresh_token ?? null

  browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

  // ---- 1. The link lands on the reset form -------------------------------
  await page.goto(confirmUrl)
  await page.waitForURL('**/reset-password', { timeout: 20_000 })
  check('recovery link lands on the reset form', true, page.url())

  // ---- 2. Setting a new password succeeds --------------------------------
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('Confirm new password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Update password' }).click()

  const success = page.getByText('Password updated', { exact: true })
  await success.waitFor({ timeout: 20_000 }).catch(() => {})

  const banner = await page
    .getByRole('alert')
    .first()
    .textContent()
    .catch(() => null)

  check(
    'submitting a new password reaches the success screen',
    await success.isVisible().catch(() => false),
    banner ? `banner said: ${banner.trim()}` : 'no error banner',
  )

  // ---- 3. The new password actually works --------------------------------
  const asUser = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: newLogin, error: newLoginError } = await asUser.auth.signInWithPassword({
    email: EMAIL,
    password: NEW_PASSWORD,
  })
  check(
    'the new password signs in',
    Boolean(newLogin?.session) && !newLoginError,
    newLoginError?.message,
  )

  // ---- 4. The old one does not -------------------------------------------
  const { data: oldLogin } = await asUser.auth.signInWithPassword({
    email: EMAIL,
    password: OLD_PASSWORD,
  })
  check('the old password no longer signs in', !oldLogin?.session)

  // ---- 4b. The session that existed before the reset is dead -------------
  // Otherwise the reset is cosmetic: whoever was already signed in stays
  // signed in, which is the exact thing the person resetting is trying to
  // stop. Refreshing a revoked token is how you prove it, not reading a list.
  const stale = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: refreshed, error: refreshError } = priorRefresh
    ? await stale.auth.refreshSession({ refresh_token: priorRefresh })
    : { data: null, error: new Error('no prior session captured') }
  check(
    'a session that existed before the reset is revoked',
    !refreshed?.session,
    refreshError?.message ?? 'refresh still worked',
  )

  // ---- 5. A reused link is refused ---------------------------------------
  // Single-use is the whole security model of an emailed token: if the second
  // redemption worked, a forwarded mail would stay live forever.
  const replay = await context.newPage()
  await replay.goto(confirmUrl)
  await replay.waitForURL('**/verify**', { timeout: 20_000 }).catch(() => {})
  check(
    'a reused recovery link is refused',
    replay.url().includes('/verify') && replay.url().includes('error'),
    replay.url(),
  )

  // ---- 6. The form on its own, with no recovery session, says so ---------
  const stranger = await browser.newContext()
  const bare = await stranger.newPage()
  await bare.goto(`${BASE}/reset-password`)
  await bare.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await bare.getByLabel('Confirm new password', { exact: true }).fill(NEW_PASSWORD)
  await bare.getByRole('button', { name: 'Update password' }).click()

  const strangerAlert = bare.getByRole('alert').first()
  await strangerAlert.waitFor({ timeout: 20_000 }).catch(() => {})
  const strangerText = (await strangerAlert.textContent().catch(() => '')) ?? ''
  check(
    'no recovery session gives the expired-link message, not "something went wrong"',
    /expired|already been used/i.test(strangerText),
    strangerText.trim() || 'no banner shown',
  )

  check('no console errors on the reset page', consoleErrors.length === 0, consoleErrors[0])

  console.log('')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} catch (error) {
  console.error('ERROR', error.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (userId) {
    await admin.auth.admin.deleteUser(userId)
    console.log('fixture user deleted')
  }
}
