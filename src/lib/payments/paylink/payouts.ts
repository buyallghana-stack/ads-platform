import 'server-only'

import { paylinkConfigured, requirePaylinkConfig, serverEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { type PaylinkPayout, createPaylinkPayout } from '@/lib/payments/paylink/client'
import { cedisToAmount } from '@/lib/payments/paylink/money'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Sending an approved crypto withdrawal through PayLink, and recording what
 * PayLink says happened to it.
 *
 * THE ORDER, AND WHY IT IS SAFE
 *   1. The points already left the member's balance when they asked
 *      (`request_redemption`). PayLink asks merchants to debit first; this
 *      app always has.
 *   2. `claim_paylink_payout` locks the withdrawal as `requesting`. From here
 *      an admin can neither decline it nor mark it paid by hand, so nobody
 *      can refund points for money that is about to leave.
 *   3. POST /payouts, with the withdrawal id as both `payout_ref` and the
 *      idempotency key. A request that dies in flight is claimed again after
 *      two minutes and sent again, and PayLink answers the repeat with the
 *      payout it already has.
 *   4. `apply_paylink_payout` records PayLink's answer. `completed` marks the
 *      withdrawal paid; `rejected` / `failed` refund the points.
 *
 * TWO LICENCE SWITCHES, BOTH REQUIRED
 * `PAYOUTS_ENABLED` in the environment and `payouts_enabled` in the database.
 * The first is checked here, the second inside `claim_paylink_payout`. Either
 * one off and nothing is sent.
 */

export type SendOutcome =
  | 'sent'
  | 'not_claimed'
  | 'not_configured'
  | 'payouts_disabled'
  | 'not_sent'
  | 'retry_later'

/** PayLink refusals that will be refused the same way again. */
const FINAL_REFUSALS = new Set([
  'validation_error',
  'invalid_address',
  'invalid_amount',
  'amount_too_small',
  'invalid_json',
  'payout_ref_conflict',
  'idempotency_key_reused',
])

export async function sendPaylinkPayout(redemptionId: string): Promise<SendOutcome> {
  if (!serverEnv().PAYOUTS_ENABLED) return 'payouts_disabled'
  if (!paylinkConfigured()) return 'not_configured'

  const admin = createAdminClient()

  const { data: claimed, error: claimError } = await admin.rpc('claim_paylink_payout' as never, {
    p_redemption_id: redemptionId,
  } as never)
  if (claimError) {
    if (/payouts are disabled/i.test(claimError.message)) return 'payouts_disabled'
    reportUnexpected(claimError, 'paylink.payout.claim', { redemptionId })
    return 'retry_later'
  }
  const row = claimed as unknown as {
    id: string
    user_id: string
    currency_amount: number | string
    /* What the member receives: the withdrawal less the fee frozen onto it
       when it was filed. Null on rows from before fees, meaning no fee. */
    net_amount: number | string | null
    snapshot_wallet: string | null
  } | null
  /* Null is the claim saying no: not approved, not a USDC on Base withdrawal,
     or already sent. Not an error. */
  if (!row?.id) return 'not_claimed'

  const amountGhs = cedisToAmount(row.net_amount ?? row.currency_amount)
  if (!amountGhs || !row.snapshot_wallet) {
    await notSent(admin, row.id, 'The withdrawal has no readable amount or wallet address.')
    return 'not_sent'
  }

  const [account, prior] = await Promise.all([
    admin.auth.admin.getUserById(row.user_id),
    admin
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', row.user_id)
      .eq('status', 'paid'),
  ])

  const result = await createPaylinkPayout({
    redemptionId: row.id,
    customerRef: row.user_id,
    /* As the member typed it. PayLink checks the checksum of a mixed-case
       address, which catches a mistyped character; lowercasing it here would
       switch that check off. A failed check comes back as `not_sent`. */
    address: row.snapshot_wallet,
    amountGhs,
    /* The truth, so PayLink's own rules see what ours saw. `flags` is empty
       because a withdrawal only gets here after our rules passed or an admin
       looked at it, and a flag would only have PayLink hold it a second time. */
    riskContext: {
      ...(account.data.user?.created_at ? { account_created_at: account.data.user.created_at } : {}),
      ...(typeof prior.count === 'number' ? { prior_successful_withdrawals: prior.count } : {}),
      flags: [],
    },
  })

  if (!result.ok) {
    if (FINAL_REFUSALS.has(result.code)) {
      await notSent(admin, row.id, `${result.code}: ${result.message}`)
      return 'not_sent'
    }
    /* Left as `requesting`. The sweep claims it again in two minutes, and a
       repeated payout_ref is harmless. A 401 or 403 is a configuration fault
       that will keep failing, so it is reported every time until fixed. */
    reportUnexpected(new Error(`PayLink payout ${result.code}: ${result.message}`), 'paylink.payout.send', {
      redemptionId: row.id,
      status: result.status,
    })
    return 'retry_later'
  }

  await applyPaylinkPayout(result.data, 'send', row.id)
  return 'sent'
}

async function notSent(admin: ReturnType<typeof createAdminClient>, redemptionId: string, message: string) {
  const { error } = await admin.rpc('paylink_payout_not_sent' as never, {
    p_redemption_id: redemptionId,
    p_error: message,
  } as never)
  if (error) reportUnexpected(error, 'paylink.payout.not_sent', { redemptionId })
}

/**
 * Records a payout object from PayLink: from the send, the IPN or the sweep.
 *
 * `redemptionId` defaults to `payout_ref`, which is ours by construction.
 */
export async function applyPaylinkPayout(
  payout: PaylinkPayout,
  via: 'send' | 'ipn' | 'sweep',
  redemptionId = payout.payout_ref,
): Promise<{ ok: true; result: string } | { ok: false; reason: 'mode_mismatch' | 'error'; message: string }> {
  const { livemode } = requirePaylinkConfig()
  if (payout.livemode !== livemode) {
    return {
      ok: false,
      reason: 'mode_mismatch',
      message: `PayLink reported a ${payout.livemode ? 'live' : 'test'} payout, but this app runs a ${livemode ? 'live' : 'test'} key.`,
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('apply_paylink_payout' as never, {
    p_redemption_id: redemptionId,
    p_payout_id: payout.payout_id,
    p_status: payout.status,
    p_failed_rules: payout.failed_rules ?? null,
    p_amount_usdc: payout.amount ?? null,
    p_rate: payout.rate?.value ?? null,
    p_tx_hash: payout.tx_hash ?? null,
    p_reason: payout.rejection_reason ?? payout.failure_reason ?? null,
  } as never)

  if (error) {
    reportUnexpected(error, 'paylink.payout.apply', { redemptionId, via, status: payout.status })
    return { ok: false, reason: 'error', message: error.message }
  }
  return { ok: true, result: String(data) }
}
