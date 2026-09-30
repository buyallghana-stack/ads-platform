import 'server-only'

import { requirePaylinkConfig } from '@/lib/env'
import { type PaymentKind } from '@/lib/payments/hub/fulfil'
import { checkSuccessAmount } from '@/lib/payments/hub/decide'
import { type PaylinkPayment } from '@/lib/payments/paylink/client'
import { amountToPesewas } from '@/lib/payments/paylink/money'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * What a PayLink payment does to this app's money.
 *
 * ONE function for the IPN, the return page and the reconciliation sweep, for
 * the reason the hub has one: they race, and the grant underneath
 * (`confirm_subscription_payment` / `confirm_vault_payment`) is idempotent by
 * payment id, so whoever arrives first grants and the rest are no-ops.
 *
 * The payment object is trusted only after three checks:
 *
 *   WHICH ROW     PayLink's `order_id` is our row id, and the row's
 *                 `external_reference` must be PayLink's `payment_id`. A
 *                 finished payment for some other order grants nothing here.
 *   WHOSE MONEY   `livemode` must match the mode of our API key, and test
 *                 money never grants in production unless an admin has said
 *                 so (`paylink_accept_test_payments`).
 *   HOW MUCH      `price_amount` / `price_currency` must be exactly what the
 *                 row asked for. The USDC figures are PayLink's business: an
 *                 overpayment still finishes, and the extra is not credited.
 */

export type PaylinkOutcome =
  | { ok: true; state: 'confirmed' | 'failed' | 'reversed' | 'pending'; alreadyDone: boolean; kind: PaymentKind; rowId: string }
  | { ok: false; reason: 'unknown_order'; detail: string }
  | { ok: false; reason: 'mismatch'; detail: string; kind: PaymentKind; rowId: string }
  | { ok: false; reason: 'mode_mismatch'; detail: string; kind: PaymentKind; rowId: string }
  | { ok: false; reason: 'error'; message: string; kind?: PaymentKind; rowId?: string }

type Row = {
  id: string
  status: string
  amount_minor: number | string
  currency_code: string
  method: string
  external_reference: string | null
}

const COLUMNS = 'id, status, amount_minor, currency_code, method, external_reference'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Our row for a PayLink `order_id`, whichever product it paid for. */
export async function findPaylinkOrder(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
): Promise<{ ok: true; kind: PaymentKind; row: Row } | { ok: false; reason: 'not_found' } | { ok: false; reason: 'error'; message: string }> {
  if (!UUID.test(orderId)) return { ok: false, reason: 'not_found' }

  const plan = await admin.from('subscription_payments').select(COLUMNS).eq('id', orderId).maybeSingle()
  if (plan.error) return { ok: false, reason: 'error', message: plan.error.message }
  if (plan.data) return { ok: true, kind: 'subscription', row: plan.data as unknown as Row }

  const vault = await admin.from('vault_payments').select(COLUMNS).eq('id', orderId).maybeSingle()
  if (vault.error) return { ok: false, reason: 'error', message: vault.error.message }
  if (vault.data) return { ok: true, kind: 'vault', row: vault.data as unknown as Row }

  return { ok: false, reason: 'not_found' }
}

/** Whether a PayLink test-mode payment may grant anything on this deployment. */
async function testMoneyAllowed(admin: ReturnType<typeof createAdminClient>): Promise<boolean> {
  /* Preview and local deployments run on a test key by design. Production is
     where test money must not become a plan. */
  if (process.env.VERCEL_ENV !== 'production') return true
  const { data } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'paylink_accept_test_payments')
    .maybeSingle()
  /* A missing row means no, which is the safe reading here. */
  return data?.value === 'true'
}

export async function applyPaylinkPayment(
  payment: PaylinkPayment,
  via: 'ipn' | 'return_page' | 'reconciliation',
): Promise<PaylinkOutcome> {
  const admin = createAdminClient()

  const found = await findPaylinkOrder(admin, payment.order_id)
  if (!found.ok) {
    return found.reason === 'error'
      ? { ok: false, reason: 'error', message: found.message }
      : { ok: false, reason: 'unknown_order', detail: `No payment row has id ${payment.order_id}` }
  }
  const { kind, row } = found

  /* WHICH ROW. The row must be a crypto row carrying this PayLink payment. */
  if (row.method !== 'crypto' || row.external_reference !== payment.payment_id) {
    return {
      ok: false,
      reason: 'mismatch',
      kind,
      rowId: row.id,
      detail:
        `PayLink payment ${payment.payment_id} names order ${row.id}, which is a ` +
        `${row.method} payment carrying reference ${row.external_reference ?? 'none'}. Nothing was changed.`,
    }
  }

  /* WHOSE MONEY. */
  const { livemode } = requirePaylinkConfig()
  if (payment.livemode !== livemode) {
    return {
      ok: false,
      reason: 'mode_mismatch',
      kind,
      rowId: row.id,
      detail: `PayLink reported a ${payment.livemode ? 'live' : 'test'} payment, but this app runs a ${livemode ? 'live' : 'test'} key. Nothing was changed.`,
    }
  }

  const payload = { via, paylink: payment } as never

  if (payment.status === 'finished') {
    if (!payment.livemode && !(await testMoneyAllowed(admin))) {
      return {
        ok: false,
        reason: 'mode_mismatch',
        kind,
        rowId: row.id,
        detail:
          'PayLink reported a TEST mode payment (testnet USDC) in production. Nothing was granted. ' +
          'Switch on paylink_accept_test_payments only for a rehearsal.',
      }
    }

    /* HOW MUCH. `checkSuccessAmount` is the same judge the hub path uses, fed
       pesewas read from PayLink's string without a float in between. */
    const stated = amountToPesewas(payment.price_amount)
    const verdict = checkSuccessAmount({
      expectedMinor: row.amount_minor,
      expectedCurrency: row.currency_code,
      statedMinor: stated === null ? null : Number(stated),
      statedCurrency: payment.price_currency,
    })
    if (!verdict.ok) {
      return { ok: false, reason: 'mismatch', kind, rowId: row.id, detail: verdict.detail }
    }

    if (row.status === 'confirmed') {
      return { ok: true, state: 'confirmed', alreadyDone: true, kind, rowId: row.id }
    }
    /* A `failed` row can still be confirmed: PayLink holds money that arrives
       after expiry for its admin, who may credit it later with a `finished`.
       The confirm functions accept a closed row for exactly that case. */
    const { error } =
      kind === 'vault'
        ? await admin.rpc('confirm_vault_payment', { p_payment_id: row.id, p_reference: payment.payment_id, p_payload: payload })
        : await admin.rpc('confirm_subscription_payment', { p_payment_id: row.id, p_reference: payment.payment_id, p_payload: payload })
    if (error) return { ok: false, reason: 'error', message: error.message, kind, rowId: row.id }
    return { ok: true, state: 'confirmed', alreadyDone: false, kind, rowId: row.id }
  }

  if (payment.status === 'expired' || payment.status === 'failed') {
    if (row.status !== 'pending') {
      return { ok: true, state: row.status === 'refunded' ? 'reversed' : 'failed', alreadyDone: true, kind, rowId: row.id }
    }
    const reason =
      payment.status === 'expired' ? 'The crypto payment expired before it was paid' : 'The crypto payment failed'
    const { error } =
      kind === 'vault'
        ? await admin.rpc('fail_vault_payment', { p_payment_id: row.id, p_reason: reason })
        : await admin.rpc('fail_subscription_payment', { p_payment_id: row.id, p_reason: reason })
    if (error) return { ok: false, reason: 'error', message: error.message, kind, rowId: row.id }
    return { ok: true, state: 'failed', alreadyDone: false, kind, rowId: row.id }
  }

  if (payment.status === 'refunded') {
    if (row.status === 'refunded') return { ok: true, state: 'reversed', alreadyDone: true, kind, rowId: row.id }
    /* Only a granted payment has anything to take back. A refund of one that
       never finished here is closed as failed instead. */
    if (row.status !== 'confirmed') {
      if (row.status === 'pending') {
        const reason = 'The crypto payment was refunded by PayLink'
        const { error } =
          kind === 'vault'
            ? await admin.rpc('fail_vault_payment', { p_payment_id: row.id, p_reason: reason })
            : await admin.rpc('fail_subscription_payment', { p_payment_id: row.id, p_reason: reason })
        if (error) return { ok: false, reason: 'error', message: error.message, kind, rowId: row.id }
      }
      return { ok: true, state: 'failed', alreadyDone: row.status !== 'pending', kind, rowId: row.id }
    }
    const reason = 'The crypto payment was refunded by PayLink'
    const { error } =
      kind === 'vault'
        ? await admin.rpc('reverse_vault_payment', { p_payment_id: row.id, p_reason: reason })
        : await admin.rpc('reverse_subscription_payment', { p_payment_id: row.id, p_reason: reason })
    if (error) return { ok: false, reason: 'error', message: error.message, kind, rowId: row.id }
    return { ok: true, state: 'reversed', alreadyDone: false, kind, rowId: row.id }
  }

  /* waiting, confirming, partially_paid: money may be on its way. Nothing to
     change; the return page shows PayLink's own status. */
  return { ok: true, state: 'pending', alreadyDone: true, kind, rowId: row.id }
}
