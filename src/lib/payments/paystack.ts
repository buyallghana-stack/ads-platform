import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

import { requirePaystackKey } from '@/lib/env'

/**
 * Paystack, the thin layer.
 *
 * Deliberately small: initialise a charge, verify one, and check a webhook
 * signature. Everything about WHAT was bought stays in the database — the
 * amount comes from the tier row inside start_subscription_payment, never from
 * anything the browser sends, so a tampered client cannot buy Platinum for one
 * pesewa.
 *
 * `server-only` because this module holds the secret key. Importing it from a
 * client component must fail the build, not ship the key.
 */

const API = 'https://api.paystack.co'

export type InitialiseResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; message: string }

/**
 * Starts a charge and returns the page to send the user to.
 *
 * The payment row's id is used as the Paystack reference. That single choice
 * gives us idempotency for free: the webhook and the browser callback both
 * arrive carrying the exact row they refer to, with nothing to look up or
 * guess.
 */
export async function initialiseTransaction(input: {
  reference: string
  email: string
  amountMinor: number
  currency: string
  callbackUrl: string
  metadata: Record<string, unknown>
}): Promise<InitialiseResult> {
  try {
    const response = await fetch(`${API}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requirePaystackKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference: input.reference,
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
      cache: 'no-store',
    })

    const body = (await response.json()) as {
      status?: boolean
      message?: string
      data?: { authorization_url?: string }
    }

    if (!response.ok || !body.status || !body.data?.authorization_url) {
      return { ok: false, message: body.message ?? `Paystack returned ${response.status}` }
    }
    return { ok: true, authorizationUrl: body.data.authorization_url }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Network error' }
  }
}

export type VerifyResult =
  | { ok: true; paid: boolean; status: string; amountMinor: number; currency: string; raw: unknown }
  | { ok: false; message: string }

/**
 * Asks Paystack what really happened.
 *
 * Never trust the browser's word for a successful payment: anyone can request
 * the callback URL with a reference. This is the only thing that decides
 * whether money arrived.
 */
export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  try {
    const response = await fetch(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${requirePaystackKey()}` },
      cache: 'no-store',
    })

    const body = (await response.json()) as {
      status?: boolean
      message?: string
      data?: { status?: string; amount?: number; currency?: string }
    }

    if (!response.ok || !body.status || !body.data) {
      return { ok: false, message: body.message ?? `Paystack returned ${response.status}` }
    }

    return {
      ok: true,
      paid: body.data.status === 'success',
      status: body.data.status ?? 'unknown',
      amountMinor: Number(body.data.amount ?? 0),
      currency: body.data.currency ?? '',
      raw: body.data,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Network error' }
  }
}

/**
 * Is this webhook really from Paystack?
 *
 * Paystack signs the RAW body with the secret key (HMAC SHA-512). The body must
 * be hashed exactly as received — parsing and re-serialising it changes the
 * bytes and the signature will never match.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false

  const expected = createHmac('sha512', requirePaystackKey()).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
