import 'server-only'

import { requireHubConfig } from '@/lib/env'
import { signHubRequest } from '@/lib/payments/hub/sign'

/**
 * Talking to the Tech Store payment hub.
 *
 * This is the whole of this app's outbound payment surface. There is no
 * Paystack call anywhere in this repository by design: the store owns the
 * account, and nothing sent to Paystack may reveal SidePerks, which is a
 * promise that is far easier to keep when we cannot talk to them at all.
 *
 * `server-only` because it signs with a shared secret. Importing it from a
 * client component must fail the build.
 */

/** Long enough for a Paystack round trip on the hub's side, short enough that
 *  a hung hub does not hold a checkout request open until the platform's own
 *  function timeout kills it with nothing written down. */
const TIMEOUT_MS = 20_000

export type HubInitialiseResult =
  | { ok: true; reference: string; authorizationUrl: string; reused: boolean }
  | { ok: false; retryable: boolean; refused: boolean; message: string }

export type HubStatus = 'initialized' | 'success' | 'failed' | 'abandoned' | 'reversed'

export type HubStatusResult =
  | {
      ok: true
      reference: string
      externalRef: string | null
      status: HubStatus
      /*
        ⚠️ PASSED THROUGH, NOT CLEANED UP. These used to be
        `Number(parsed.amount_minor ?? 0)` and `(parsed.currency ?? 'GHS')`,
        which turned "the hub said nothing" into "the hub said zero cedis" and
        into "the hub said GHS" before anything downstream could notice the
        difference. Judging them is `decide.ts`'s job and it needs the absence
        to survive the journey, so the raw value arrives as it came.
      */
      amountMinor: number | string | null
      currency: string | null
      /* `live` or `test`, when the hub sends it. It does not yet. */
      domain: string | null
      paidAt: string | null
    }
  | { ok: false; retryable: boolean; notFound: boolean; message: string }

async function callHub(
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
): Promise<{ response: Response; text: string } | { error: string }> {
  const { url, secrets } = requireHubConfig()
  const body = init.body ?? ''
  const headers = signHubRequest({ secrets, body })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${url}${path}`, {
      method: init.method,
      headers: {
        ...headers,
        ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      /* The signature covers the EXACT bytes. `body` has to be the string that
         was signed, never an object re-serialised by fetch, or the hub
         recomputes a different digest and refuses a request we sent correctly. */
      ...(init.method === 'POST' ? { body } : {}),
      cache: 'no-store',
      signal: controller.signal,
    })
    return { response, text: await response.text() }
  } catch (error) {
    return {
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'The payment hub did not answer in time.'
          : error instanceof Error
            ? error.message
            : 'Could not reach the payment hub.',
    }
  } finally {
    clearTimeout(timer)
  }
}

const messageFrom = (text: string, fallback: string): string => {
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string }
    return parsed.message ?? parsed.error ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Starts a payment and returns the page to send the user to.
 *
 * `externalRef` is this app's `subscription_payments.id`. Asking twice for the
 * same one returns the payment already running with `reused: true`, so a user
 * who reloads the checkout is sent back to the same Paystack page rather than
 * being charged on a second one.
 */
export async function hubInitialise(input: {
  externalRef: string
  amountMinor: number
  currency: string
  customerEmail: string
  returnUrl: string
}): Promise<HubInitialiseResult> {
  /* Integer pesewas. 52000 is GHS 520.00. A float here would be rejected by
     the hub, and worse, a rounding error would be a real price difference. */
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    return { ok: false, retryable: false, refused: false, message: 'A payment amount must be whole pesewas.' }
  }

  const body = JSON.stringify({
    external_ref: input.externalRef,
    amount_minor: input.amountMinor,
    currency: input.currency,
    customer_email: input.customerEmail,
    return_url: input.returnUrl,
  })

  const called = await callHub('/api/internal/hub/payments/initialize', { method: 'POST', body })
  if ('error' in called) return { ok: false, retryable: true, refused: false, message: called.error }

  const { response, text } = called
  if (!response.ok) {
    /* 500 is the hub's fault and worth another go. 401, 400 and 422 are ours:
       an unsigned, malformed or refused request will be refused again, and
       retrying only delays telling the user. */
    return {
      ok: false,
      retryable: response.status >= 500,
      /* 422 is the hub REFUSING on business grounds, and in practice that
         almost always means Paystack would not accept the customer's email.
         It matters that this is distinguishable, because the hub's own wording
         for it is "Could not reach the payment provider", which sends whoever
         reads it hunting for a network fault that is not there. */
      refused: response.status === 422,
      message: messageFrom(text, `The payment hub returned ${response.status}.`),
    }
  }

  let parsed: { reference?: string; authorization_url?: string; reused?: boolean }
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    return { ok: false, retryable: true, refused: false, message: 'The payment hub sent an unreadable answer.' }
  }

  if (!parsed.reference || !parsed.authorization_url) {
    return { ok: false, retryable: true, refused: false, message: 'The payment hub did not return a payment link.' }
  }

  return {
    ok: true,
    reference: parsed.reference,
    authorizationUrl: parsed.authorization_url,
    reused: parsed.reused === true,
  }
}

/**
 * Asks the hub what really happened to a payment.
 *
 * The hub re-verifies an intent that is still `initialized` with Paystack
 * before answering, behind a ten second floor per reference. A return page may
 * poll; polling faster than that gets the cached answer, so there is nothing
 * to gain from a tight loop.
 */
export async function hubPaymentStatus(reference: string): Promise<HubStatusResult> {
  const called = await callHub(
    `/api/internal/hub/payments/${encodeURIComponent(reference)}`,
    { method: 'GET' },
  )
  if ('error' in called) {
    return { ok: false, retryable: true, notFound: false, message: called.error }
  }

  const { response, text } = called
  if (!response.ok) {
    /* A 404 is not a failure to answer, it is an answer: the hub has no such
       SidePerks payment. Genuine Tech Store references 404 here too, which is
       the separation working. */
    return {
      ok: false,
      retryable: response.status >= 500,
      notFound: response.status === 404,
      message: messageFrom(text, `The payment hub returned ${response.status}.`),
    }
  }

  let parsed: {
    reference?: string
    external_ref?: string | null
    status?: HubStatus
    amount_minor?: number | string | null
    currency?: string | null
    domain?: string | null
    paid_at?: string | null
  }
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    return { ok: false, retryable: true, notFound: false, message: 'The payment hub sent an unreadable answer.' }
  }

  if (!parsed.reference || !parsed.status) {
    return { ok: false, retryable: true, notFound: false, message: 'The payment hub sent an incomplete answer.' }
  }

  return {
    ok: true,
    reference: parsed.reference,
    externalRef: parsed.external_ref ?? null,
    status: parsed.status,
    amountMinor: parsed.amount_minor ?? null,
    currency: parsed.currency ?? null,
    domain: parsed.domain ?? null,
    paidAt: parsed.paid_at ?? null,
  }
}
