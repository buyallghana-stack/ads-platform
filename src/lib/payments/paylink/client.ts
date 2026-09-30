import 'server-only'

import { requirePaylinkConfig } from '@/lib/env'

/**
 * Talking to PayLink's merchant API.
 *
 * Every call comes from this server with the API key in `x-api-key`; the key
 * never reaches a browser. Every POST carries an `Idempotency-Key`, and the key
 * is always one of OUR ids (a payment row, a withdrawal), so a retried request
 * after a timeout gets PayLink's original answer back rather than a second
 * payment or a second payout.
 *
 * The result says whether a failure is worth retrying. A 4xx is ours and will
 * fail the same way again; a 5xx, a 429 or a network fault may not.
 */

const TIMEOUT_MS = 15_000

/** A payment as PayLink returns it and as it arrives in `payment.updated`. */
export type PaylinkPayment = {
  payment_id: string
  status: 'waiting' | 'confirming' | 'partially_paid' | 'finished' | 'expired' | 'failed' | 'refunded'
  livemode: boolean
  order_id: string
  price_amount: string
  price_currency: string
  pay_amount: string
  amount_received: string
  remaining_amount: string
  overpaid_amount: string
  expires_at: string | null
  checkout_url: string
}

/** A payout as PayLink returns it and as it arrives in `payout.updated`. */
export type PaylinkPayout = {
  payout_id: string
  payout_ref: string
  status: 'queued' | 'held_for_review' | 'sending' | 'completed' | 'rejected' | 'failed'
  livemode: boolean
  amount: string
  currency: 'USDC'
  requested_amount: string
  requested_currency: string
  rate: { pair: string; value: string; fetched_at: string } | null
  failed_rules: string[]
  tx_hash: string | null
  failure_reason: string | null
  rejection_reason: string | null
}

export type PaylinkError = {
  ok: false
  /** HTTP status, or 0 when PayLink could not be reached at all. */
  status: number
  /** PayLink's error code, e.g. `open_payment_exists`. */
  code: string
  message: string
  retryable: boolean
  /** Extra fields PayLink put next to the code, e.g. `payment_id`. */
  details: Record<string, unknown>
}

export type PaylinkResult<T> = { ok: true; status: number; data: T } | PaylinkError

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<PaylinkResult<T>> {
  const { url, key } = requirePaylinkConfig()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  let text: string
  try {
    response = await fetch(`${url}${path}`, {
      method: init.method,
      headers: {
        'x-api-key': key,
        ...(init.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
      },
      ...(init.method === 'POST' ? { body: JSON.stringify(init.body ?? {}) } : {}),
      cache: 'no-store',
      signal: controller.signal,
    })
    text = await response.text()
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: 'unreachable',
      message:
        error instanceof Error && error.name === 'AbortError'
          ? 'PayLink did not answer in time.'
          : error instanceof Error
            ? error.message
            : 'Could not reach PayLink.',
      retryable: true,
      details: {},
    }
  } finally {
    clearTimeout(timer)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      status: response.status,
      code: 'unreadable',
      message: `PayLink sent an unreadable answer (${response.status}).`,
      retryable: true,
      details: {},
    }
  }

  if (!response.ok) {
    const { code, message, ...details } =
      ((parsed as { error?: Record<string, unknown> }).error ?? {}) as Record<string, unknown>
    return {
      ok: false,
      status: response.status,
      code: typeof code === 'string' ? code : 'http_' + response.status,
      message: typeof message === 'string' ? message : `PayLink returned ${response.status}.`,
      retryable: response.status >= 500 || response.status === 429,
      details,
    }
  }

  return { ok: true, status: response.status, data: parsed as T }
}

export function createPaylinkPayment(input: {
  /** Our payment row's id: PayLink's `order_id`, and the idempotency key. */
  orderId: string
  /** Cedis as a 2-decimal string, e.g. "520.00". */
  priceAmount: string
  description: string
  /** Our user id. A random uuid, never a name, email or phone number. */
  customerRef: string
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
}): Promise<PaylinkResult<PaylinkPayment>> {
  return call<PaylinkPayment>('/payments', {
    method: 'POST',
    idempotencyKey: `payment-${input.orderId}`,
    body: {
      price_amount: input.priceAmount,
      price_currency: 'GHS',
      order_id: input.orderId,
      order_description: input.description,
      customer_ref: input.customerRef,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
    },
  })
}

export function getPaylinkPayment(paymentId: string): Promise<PaylinkResult<PaylinkPayment>> {
  return call<PaylinkPayment>(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' })
}

export function cancelPaylinkPayment(paymentId: string): Promise<PaylinkResult<PaylinkPayment>> {
  return call<PaylinkPayment>(`/payments/${encodeURIComponent(paymentId)}/cancel`, {
    method: 'POST',
    idempotencyKey: `cancel-${paymentId}`,
  })
}

export function createPaylinkPayout(input: {
  /** Our withdrawal id: PayLink's `payout_ref`, and the idempotency key. */
  redemptionId: string
  customerRef: string
  address: string
  /** Cedis as a 2-decimal string. PayLink converts at its own rate. */
  amountGhs: string
  riskContext: {
    account_created_at?: string
    prior_successful_withdrawals?: number
    flags?: string[]
  }
}): Promise<PaylinkResult<PaylinkPayout>> {
  return call<PaylinkPayout>('/payouts', {
    method: 'POST',
    idempotencyKey: `payout-${input.redemptionId}`,
    body: {
      payout_ref: input.redemptionId,
      customer_ref: input.customerRef,
      address: input.address,
      amount: input.amountGhs,
      currency: 'GHS',
      risk_context: input.riskContext,
    },
  })
}

export function getPaylinkPayout(payoutId: string): Promise<PaylinkResult<PaylinkPayout>> {
  return call<PaylinkPayout>(`/payouts/${encodeURIComponent(payoutId)}`, { method: 'GET' })
}
