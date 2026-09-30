import 'server-only'

import { clientEnv, paylinkConfigured, requirePaylinkConfig } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { type PaymentKind } from '@/lib/payments/hub/fulfil'
import {
  type PaylinkPayment,
  cancelPaylinkPayment,
  createPaylinkPayment,
  getPaylinkPayment,
} from '@/lib/payments/paylink/client'
import { applyPaylinkPayment, findPaylinkOrder } from '@/lib/payments/paylink/fulfil'
import { pesewasToAmount } from '@/lib/payments/paylink/money'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Handing a payment row to PayLink and getting back the page to send the
 * buyer to.
 *
 * The row already exists and is priced: `start_subscription_payment` or
 * `start_vault_payment` decided the amount, the coupon and every refusal, as
 * they do for every other rail. PayLink is only ever told a figure this
 * database agreed to, in cedis, and converts it to USDC itself.
 */

export type PaylinkCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; errorKey: 'cryptoUnavailable' | 'cryptoOpenElsewhere' | 'failed'; message?: string }

/** Whether the crypto option may be shown and used at all. */
export async function paylinkCheckoutEnabled(): Promise<boolean> {
  if (!paylinkConfigured()) return false
  const admin = createAdminClient()
  const { data } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'paylink_checkout_enabled')
    .maybeSingle()
  return data?.value === 'true'
}

export async function handToPaylink(input: {
  kind: PaymentKind
  row: { id: string; amount_minor: number | string; currency_code: string }
  userId: string
  description: string
}): Promise<PaylinkCheckoutResult> {
  const admin = createAdminClient()
  const { kind, row, userId } = input

  const closeRow = async (reason: string) => {
    await (kind === 'vault'
      ? admin.rpc('fail_vault_payment', { p_payment_id: row.id, p_reason: reason })
      : admin.rpc('fail_subscription_payment', { p_payment_id: row.id, p_reason: reason }))
  }

  const price = pesewasToAmount(row.amount_minor)
  if (!price || row.currency_code.trim() !== 'GHS') {
    /* PayLink prices in GHS or USD, and every price here is cedis. Anything
       else is a row this path was never meant to see. */
    await closeRow('Crypto checkout only takes cedi prices')
    return { ok: false, errorKey: 'failed' }
  }

  /* A Vault row is created as `paystack`. Switching it before PayLink knows
     about it keeps the hub's reconciliation sweep from ever asking the hub
     about a PayLink reference. */
  if (kind === 'vault') {
    const { error } = await admin.rpc('mark_vault_payment_crypto' as never, { p_payment_id: row.id } as never)
    if (error) {
      reportUnexpected(error, 'paylink.checkout', { step: 'mark_crypto', rowId: row.id })
      return { ok: false, errorKey: 'failed' }
    }
  }

  const base = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')
  const request = () =>
    createPaylinkPayment({
      orderId: row.id,
      priceAmount: price,
      description: input.description,
      customerRef: userId,
      successUrl: `${base}/payments/return?paylink=${row.id}`,
      cancelUrl: `${base}${kind === 'vault' ? '/vault' : '/upgrade'}`,
      metadata: { kind },
    })

  let created = await request()

  /*
    ONE OPEN PAYMENT PER CUSTOMER. PayLink gives a customer the same deposit
    address every time, so it allows one unpaid payment per customer. A buyer
    who started a crypto checkout and came back for a different plan hits
    this. If the open one is ours, still pending and unpaid, it is cancelled
    and closed here, and the new one is created. Anything else is not ours
    to cancel.
  */
  if (!created.ok && created.code === 'open_payment_exists') {
    const openId = typeof created.details.payment_id === 'string' ? created.details.payment_id : null
    const cleared = openId ? await cancelIfAbandoned(admin, openId, userId) : false
    if (!cleared) return { ok: false, errorKey: 'cryptoOpenElsewhere' }
    created = await request()
  }

  if (!created.ok) {
    if (!created.retryable) await closeRow(`PayLink refused: ${created.code}`)
    if (created.status !== 503) {
      reportUnexpected(new Error(`PayLink ${created.code}: ${created.message}`), 'paylink.checkout', {
        rowId: row.id,
        status: created.status,
      })
    }
    return { ok: false, errorKey: created.status === 503 ? 'cryptoUnavailable' : 'failed' }
  }

  const payment = created.data

  /* The reference is stored BEFORE the buyer leaves: it is what ties every
     IPN about this payment back to this row. */
  const { error: attachError } =
    kind === 'vault'
      ? await admin.rpc('attach_vault_hub_reference', { p_payment_id: row.id, p_reference: payment.payment_id })
      : await admin.rpc('attach_hub_reference', { p_payment_id: row.id, p_reference: payment.payment_id })
  if (attachError) {
    reportUnexpected(attachError, 'paylink.checkout', { step: 'attach', rowId: row.id })
    return { ok: false, errorKey: 'failed' }
  }

  /* Only ever send the buyer to PayLink itself. The URL came over the
     network, and a redirect to wherever a response says is how a compromised
     or spoofed answer becomes a phishing page. */
  if (!isPaylinkCheckoutUrl(payment.checkout_url)) {
    reportUnexpected(new Error('PayLink returned a checkout URL on another origin'), 'paylink.checkout', {
      rowId: row.id,
    })
    return { ok: false, errorKey: 'failed' }
  }

  return { ok: true, checkoutUrl: payment.checkout_url }
}

function isPaylinkCheckoutUrl(url: string): boolean {
  try {
    const target = new URL(url)
    const api = new URL(requirePaylinkConfig().url)
    return target.protocol === 'https:' && target.origin === api.origin
  } catch {
    return false
  }
}

/**
 * Cancels the buyer's open PayLink payment if it is one of ours, still
 * pending, and nothing has arrived for it. Closes our row too. True when the
 * way is clear for a new payment.
 */
async function cancelIfAbandoned(
  admin: ReturnType<typeof createAdminClient>,
  paymentId: string,
  userId: string,
): Promise<boolean> {
  const current = await getPaylinkPayment(paymentId)
  if (!current.ok) return false
  const open: PaylinkPayment = current.data
  /* Money already on its way to that payment: cancelling it would strand it. */
  if (open.status !== 'waiting' || open.amount_received !== '0.000000') return false

  const found = await findPaylinkOrder(admin, open.order_id)
  if (!found.ok || found.row.external_reference !== paymentId || found.row.status !== 'pending') return false

  const table = found.kind === 'vault' ? 'vault_payments' : 'subscription_payments'
  const { data: owner } = await admin.from(table).select('user_id').eq('id', found.row.id).maybeSingle()
  if ((owner as { user_id?: string } | null)?.user_id !== userId) return false

  const cancelled = await cancelPaylinkPayment(paymentId)
  if (!cancelled.ok) return false

  const reason = 'Replaced by a newer crypto checkout'
  await (found.kind === 'vault'
    ? admin.rpc('fail_vault_payment', { p_payment_id: found.row.id, p_reason: reason })
    : admin.rpc('fail_subscription_payment', { p_payment_id: found.row.id, p_reason: reason }))
  return true
}

/**
 * The return page's question: what happened to this crypto payment?
 *
 * Settles from PayLink's own answer (`GET /payments/:id`) rather than from the
 * buyer arriving at `success_url`, which anyone can type. The same
 * `applyPaylinkPayment` the IPN uses, so the two cannot disagree.
 */
export async function settleFromPaylink(
  rowId: string,
  userId: string,
): Promise<{ state: 'confirmed' | 'pending' | 'failed' | 'reversed' | 'unknown'; kind?: PaymentKind; paylinkStatus?: string }> {
  const admin = createAdminClient()
  const found = await findPaylinkOrder(admin, rowId)
  if (!found.ok || found.row.method !== 'crypto') return { state: 'unknown' }
  const { kind, row } = found

  const table = kind === 'vault' ? 'vault_payments' : 'subscription_payments'
  const { data: owner } = await admin.from(table).select('user_id').eq('id', row.id).maybeSingle()
  /* Somebody else's payment is somebody else's business. */
  if ((owner as { user_id?: string } | null)?.user_id !== userId) return { state: 'unknown' }

  if (row.status === 'confirmed') return { state: 'confirmed', kind }
  if (row.status === 'refunded') return { state: 'reversed', kind }
  if (!row.external_reference) return { state: row.status === 'failed' ? 'failed' : 'pending', kind }

  const current = await getPaylinkPayment(row.external_reference)
  /* Unreachable is not failed: somebody who has just sent USDC must not be
     told it failed because a call timed out. */
  if (!current.ok) return { state: row.status === 'failed' ? 'failed' : 'pending', kind }

  const outcome = await applyPaylinkPayment(current.data, 'return_page')
  if (!outcome.ok) return { state: 'pending', kind, paylinkStatus: current.data.status }
  return { state: outcome.state, kind, paylinkStatus: current.data.status }
}
