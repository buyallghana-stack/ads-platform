'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { getRequestContext } from '@/lib/request-context'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Filing a withdrawal — the first link in the payout chain.
 *
 * Until 2026-07-29 this file only verified the PIN and the wizard jumped
 * straight to its success screen. Nothing was written, so no request ever
 * reached the admin queue and that queue could only ever be empty. This closes
 * the gap: `request_redemption` runs for real, the points leave the balance,
 * and the row appears on the payouts screen.
 *
 * THE PIN CHECK AND THE WRITE ARE ONE ACTION, DELIBERATELY
 * They used to be separable, and must never be again. A server action is a
 * public HTTP endpoint: if verifying the PIN and filing the request were two
 * calls, anybody could call the second and skip the first. A PIN is only a
 * control while it is checked in the same breath as the thing it guards.
 *
 * WHY THIS DOES NOT WAIT ON THE PAYOUTS LICENCE SWITCH
 * The comments this file used to carry said the request path waited on
 * `PAYOUTS_ENABLED`. That was wrong. `mark_redemption_paid` is the only
 * function that checks the licence switches; requesting, holding, approving
 * and declining all work with them off. That is exactly the state the
 * platform wants to be in right now — real requests can queue up and an
 * operator can review them, and the single thing nobody can do is assert that
 * cash left the business.
 */

/** Why the database refused, in a form the UI can translate. */
export type RefusalCode =
  | 'no_details'
  | 'cooloff'
  | 'insufficient'
  | 'below_minimum'
  | 'disabled'
  | 'too_small'
  | 'unknown'

export type WithdrawResult =
  | {
      ok: true
      /** Derived exactly as the admin queue derives it, so a user and an
       *  operator on the phone are quoting the same identifier. */
      reference: string
      points: number
      ghs: number
      /** When the fraud-catch hold elapses and it reaches the review queue. */
      holdingUntil: string
    }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; retryAfter: string | null }
  | { ok: false; reason: 'no_pin' }
  | { ok: false; reason: 'refused'; code: RefusalCode; hours: number | null; detail: string }
  | { ok: false; reason: 'error' }

export async function requestWithdrawal(input: {
  method: 'mobile_money' | 'crypto'
  points: number
  pin: string
}): Promise<WithdrawResult> {
  const { method, points, pin } = input

  if (!/^[0-9]{4}$/.test(pin)) return { ok: false, reason: 'error' }
  if (method !== 'mobile_money' && method !== 'crypto') return { ok: false, reason: 'error' }
  if (!Number.isSafeInteger(points) || points <= 0) return { ok: false, reason: 'error' }

  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'error' }

  const admin = createAdminClient()

  /* ---- 1. The PIN, rate-limited server-side (5 wrong -> 15 min) -------- */
  const { data: pinData, error: pinError } = await admin.rpc('verify_withdrawal_pin', {
    p_user_id: user.id,
    p_pin: pin,
  })
  if (pinError || !pinData) return { ok: false, reason: 'error' }

  const verdict = pinData as {
    ok: boolean
    no_pin?: boolean
    locked?: boolean
    retry_after?: string
    attempts_left?: number
  }

  if (!verdict.ok) {
    if (verdict.no_pin) return { ok: false, reason: 'no_pin' }
    if (verdict.locked) {
      return { ok: false, reason: 'locked', retryAfter: verdict.retry_after ?? null }
    }
    return { ok: false, reason: 'wrong', attemptsLeft: verdict.attempts_left ?? 0 }
  }

  /* ---- 2. The request itself ------------------------------------------ */
  //
  // Every remaining rule — tier minimum, sufficient balance, details on file,
  // the 48-hour cool-off after changing where the money goes, disabled
  // accounts — lives inside request_redemption and is enforced there. None is
  // re-implemented here: the wizard's own checks exist to save a round trip,
  // not to be the enforcement.
  const { ip } = await getRequestContext()

  // No `.single()`. The function returns a composite type, not a set, so
  // PostgREST already answers with one JSON object — verified against the
  // live API. Asking for single-object on top adds a way to fail and buys
  // nothing.
  const { data, error } = await admin.rpc('request_redemption', {
    p_user_id: user.id,
    p_method: method,
    p_points: points,
    p_ip: ip,
  })

  if (error) return classify(error.message)
  if (!data) return { ok: false, reason: 'error' }

  const row = data as unknown as {
    redemption_id: string
    points: number | string
    currency: number | string
    holding_until: string
  }

  // The balance hero and the transaction history both change the instant this
  // succeeds, and the notification trigger has just written a row.
  revalidatePath('/dashboard')
  revalidatePath('/notifications')

  return {
    ok: true,
    reference: `RDM-${row.redemption_id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    points: Number(row.points),
    ghs: Number(row.currency),
    holdingUntil: row.holding_until,
  }
}

/**
 * Turns a Postgres refusal into something the UI can act on.
 *
 * Matching on message text is not lovely, but the alternative is threading
 * error codes back through a function the entire pipeline depends on. These
 * exact phrasings are asserted by the money-critical tests, so rewording one
 * fails a test rather than silently degrading a user to "unknown".
 *
 * `detail` carries the original through, because the pipeline writes these in
 * plain English and showing one beats showing nothing.
 */
function classify(message: string): WithdrawResult {
  const m = message.toLowerCase()

  if (m.includes('before requesting a payout')) {
    return { ok: false, reason: 'refused', code: 'no_details', hours: null, detail: message }
  }
  if (m.includes('changed recently')) {
    // "You can request a payout in 12 hour(s)." — lift the number out so the
    // UI can say WHEN, not merely that they have to wait.
    const hours = Number(/in (\d+)/.exec(message)?.[1] ?? NaN)
    return {
      ok: false,
      reason: 'refused',
      code: 'cooloff',
      hours: Number.isFinite(hours) ? hours : null,
      detail: message,
    }
  }
  if (m.includes('minimum payout')) {
    return { ok: false, reason: 'refused', code: 'below_minimum', hours: null, detail: message }
  }
  if (m.includes('insufficient')) {
    return { ok: false, reason: 'refused', code: 'insufficient', hours: null, detail: message }
  }
  if (m.includes('disabled')) {
    return { ok: false, reason: 'refused', code: 'disabled', hours: null, detail: message }
  }
  if (m.includes('too small')) {
    return { ok: false, reason: 'refused', code: 'too_small', hours: null, detail: message }
  }

  return { ok: false, reason: 'refused', code: 'unknown', hours: null, detail: message }
}
