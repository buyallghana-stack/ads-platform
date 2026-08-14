'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { getViewAsSession } from '@/lib/admin/view-as'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Filing a COMMISSION withdrawal.
 *
 * Deliberately a separate file from `(app)/withdraw/actions.ts`, which does the
 * same job for points. The two look similar and must not be merged: one moves
 * points through a peg and the other moves cedis that are already cedis, they
 * read different balances, enforce different minimums and write to different
 * ledgers. A single function with a `kind` parameter branching at every step is
 * how the two eventually contaminate each other, and D27 — points and
 * commission never mix — is the one rule this business cannot afford to bend.
 *
 * ── THE PIN CHECK AND THE WRITE ARE ONE ACTION ──
 *
 * Copied deliberately from the points path, where it is written in blood. A
 * server action is a PUBLIC HTTP ENDPOINT: if verifying the PIN and filing the
 * request were two calls, anybody could call the second and skip the first. A
 * PIN is only a control while it is checked in the same breath as the thing it
 * guards.
 *
 * The database does not require a PIN for `request_commission_payout` — the
 * points path's `request_redemption` does not either. It is enforced here, on
 * both paths, because the money is equally real and an affiliate balance is if
 * anything the easier of the two to build up quietly.
 *
 * ── EVERY OTHER RULE LIVES IN POSTGRES ──
 *
 * The payouts switch, the affiliate account, suspension, payout details on
 * file, the 48-hour cool-off after changing where money goes, a positive
 * balance, the minimum, the ceiling, the fee, and the frozen crypto quote are
 * all inside `request_commission_payout`. None is re-implemented here. The
 * form's own checks exist to save a round trip, not to be the enforcement.
 */

/** Why the database refused, in a form the UI can translate. */
export type CommissionRefusal =
  | 'closed'
  | 'not_affiliate'
  | 'suspended'
  | 'no_details'
  | 'cooloff'
  | 'nothing'
  | 'below_minimum'
  | 'too_much'
  | 'already_open'
  | 'unknown'

export type CommissionWithdrawResult =
  | {
      ok: true
      /** Same shape the admin queue derives, so a user and an operator on the
       *  phone are quoting the same identifier. */
      reference: string
      amountMinor: number
      feeMinor: number
      netMinor: number
      /** Crypto only, read back from the WRITTEN row rather than echoed from
       *  the form: the success screen must state what was recorded, not what
       *  the client last calculated. The coin amount is frozen at request time
       *  (locked operator rule — whoever asked for 12 USDT receives 12 USDT). */
      coin?: string
      coinAmount?: number
    }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; retryAfter: string | null }
  | { ok: false; reason: 'no_pin' }
  | { ok: false; reason: 'refused'; code: CommissionRefusal; detail: string }
  | { ok: false; reason: 'error' }

export async function requestCommissionWithdrawal(input: {
  amountMinor: number
  pin: string
  /** Which of their destinations. Omitted only when they hold exactly one. */
  method?: 'mobile_money' | 'crypto'
}): Promise<CommissionWithdrawResult> {
  const { amountMinor, pin, method } = input

  if (!/^[0-9]{4}$/.test(pin)) return { ok: false, reason: 'error' }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, reason: 'error' }
  }

  /* The SIGNED-IN user, never the viewed one, and refused outright while a
     super admin has a look open. Reads render the viewed account so "view as
     user" works; a write that moves money must not. */
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'error' }
  if (await getViewAsSession()) return { ok: false, reason: 'error' }

  const admin = createAdminClient()

  /* ---- 1. The PIN, rate-limited server-side (5 wrong -> 15 min) --------- */
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
      return {
        ok: false,
        reason: 'locked',
        retryAfter: verdict.retry_after ?? null,
      }
    }
    return {
      ok: false,
      reason: 'wrong',
      attemptsLeft: verdict.attempts_left ?? 0,
    }
  }

  /* ---- 2. The request itself ------------------------------------------- */
  const { data, error } = await admin.rpc('request_commission_payout', {
    p_user_id: user.id,
    p_amount_minor: amountMinor,
    /* Which destination. Sent explicitly because the function refuses to
       guess when somebody holds two, rather than paying an arbitrary one. */
    p_method: method ?? undefined,
  })

  if (error) {
    const classified = classify(error.message)
    /* Only the branch that ran out of explanations. Every other code is the
       pipeline refusing for a reason we wrote, and reporting those would bury
       the one that means something. */
    if (!classified.ok && classified.reason === 'refused' && classified.code === 'unknown') {
      reportUnexpected(error, 'commission.withdraw', {
        message: error.message,
      })
    }
    return classified
  }
  if (!data) return { ok: false, reason: 'error' }

  const row = data as unknown as {
    id: string
    amount_minor: number | string
    fee_minor: number | string
    net_minor: number | string
    snapshot_coin_code: string | null
    coin_amount: number | string | null
  }

  /* The statement, the balance on the dashboard and the notification the
     trigger just wrote all change the instant this succeeds. */
  revalidatePath('/commission')
  revalidatePath('/market')
  revalidatePath('/notifications')

  return {
    ok: true,
    reference: `CMS-${row.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    amountMinor: Number(row.amount_minor),
    feeMinor: Number(row.fee_minor),
    netMinor: Number(row.net_minor),
    coin: row.snapshot_coin_code ?? undefined,
    coinAmount: row.coin_amount === null ? undefined : Number(row.coin_amount),
  }
}

/**
 * Turns a Postgres refusal into something the UI can act on.
 *
 * Matching on message text is not lovely, but the alternative is threading
 * error codes back through a function the whole payout chain depends on. These
 * exact phrasings are asserted by tests, so rewording one in SQL fails a test
 * rather than silently degrading a user to "unknown".
 *
 * `detail` carries the original through, because the pipeline writes these in
 * plain English — and two of them contain the actual number (the minimum, the
 * balance), which is more useful than anything this layer could substitute.
 *
 * ⚠️ ONE REFUSAL IS NOT A `raise exception` AT ALL. "One open request at a
 * time" is enforced by the unique index `commission_payouts_one_open_idx`, so
 * Postgres answers with its own words — `duplicate key value violates unique
 * constraint …`. That is a sentence written for a database administrator, on a
 * money screen, in front of a person who tapped Confirm twice. It gets its own
 * code, and `detail` is only ever shown for the messages this project wrote.
 */
function classify(message: string): CommissionWithdrawResult {
  const m = message.toLowerCase()
  const refused = (code: CommissionRefusal): CommissionWithdrawResult => ({
    ok: false,
    reason: 'refused',
    code,
    detail: message,
  })

  if (m.includes('not open yet')) return refused('closed')
  if (m.includes('not an affiliate')) return refused('not_affiliate')
  if (m.includes('suspended')) return refused('suspended')
  if (m.includes('where to send your money')) return refused('no_details')
  if (m.includes('changed recently')) return refused('cooloff')
  if (m.includes('nothing to withdraw')) return refused('nothing')
  if (m.includes('the least you can withdraw')) return refused('below_minimum')
  if (m.includes('you only have')) return refused('too_much')
  if (m.includes('commission_payouts_one_open_idx') || m.includes('duplicate key')) {
    return refused('already_open')
  }

  return refused('unknown')
}
