import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

/**
 * The signature on every request between this app and the Tech Store hub.
 *
 * Both directions use the same scheme, which is the point: one implementation,
 * one set of tests, and no chance of the two sides disagreeing about what is
 * signed. The contract is in docs/payment-hub-contract.md and the hub side is
 * already live against it, so this file matches a running implementation
 * rather than an intention.
 *
 *     X-Hub-Timestamp    unix SECONDS
 *     X-Hub-Request-Id   uuid, usable once
 *     X-Hub-Signature    hex HMAC-SHA256(secret, "<timestamp>.<request_id>.<raw body>")
 *
 * ⚠️ THE TIMESTAMP AND THE ID ARE INSIDE THE SIGNED MATERIAL. They are headers
 * too, but that is only how they travel. If they were merely headers, either
 * could be rewritten while the signature stayed valid, and a captured request
 * would never go stale. Signing them is what makes the freshness check mean
 * anything.
 *
 * This module is pure and takes its secrets as arguments so it can be tested
 * without an environment. It deliberately does NOT know about replay
 * protection: remembering which request ids have been seen needs storage that
 * survives a restart, so that lives in the database.
 */

/** How far apart the two clocks may be, in seconds. */
export const HUB_CLOCK_SKEW_SECONDS = 300

export const HUB_TIMESTAMP_HEADER = 'x-hub-timestamp'
export const HUB_REQUEST_ID_HEADER = 'x-hub-request-id'
export const HUB_SIGNATURE_HEADER = 'x-hub-signature'

/**
 * The exact bytes covered by the signature.
 *
 * A GET has no body and signs over the empty string. The timestamp and the id
 * are still in there, so it still cannot be replayed.
 */
export function hubSigningMaterial(timestamp: number, requestId: string, body: string): string {
  return `${timestamp}.${requestId}.${body}`
}

export function hubSignature(secret: string, timestamp: number, requestId: string, body: string) {
  return createHmac('sha256', secret).update(hubSigningMaterial(timestamp, requestId, body)).digest('hex')
}

export type SignedHeaders = {
  [HUB_TIMESTAMP_HEADER]: string
  [HUB_REQUEST_ID_HEADER]: string
  [HUB_SIGNATURE_HEADER]: string
}

/**
 * Headers for an outgoing request.
 *
 * Signs with the FIRST secret in the list. The list is newest first, so a
 * rotation is: add the new secret to the front on both sides, let anything in
 * flight settle, then drop the old one from the back.
 */
export function signHubRequest(input: {
  secrets: string[]
  body?: string
  now?: number
  requestId?: string
}): SignedHeaders {
  const secret = input.secrets[0]
  if (!secret) {
    throw new Error('Cannot sign a hub request with no secret configured.')
  }
  const timestamp = Math.floor((input.now ?? Date.now()) / 1000)
  const requestId = input.requestId ?? randomUUID()
  const body = input.body ?? ''

  return {
    [HUB_TIMESTAMP_HEADER]: String(timestamp),
    [HUB_REQUEST_ID_HEADER]: requestId,
    [HUB_SIGNATURE_HEADER]: hubSignature(secret, timestamp, requestId, body),
  }
}

export type VerifyFailure =
  | 'missing_headers'
  | 'bad_timestamp'
  | 'stale'
  | 'bad_request_id'
  | 'no_secret'
  | 'bad_signature'

export type VerifyResult =
  | { ok: true; timestamp: number; requestId: string }
  | { ok: false; reason: VerifyFailure }

/** A uuid in any version, since the hub picks the version, not us. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Checks an incoming request.
 *
 * Accepts ANY of the configured secrets, so the other side can rotate without
 * a flag day. Every comparison is constant time: an HMAC check that returns
 * early on the first wrong byte leaks the answer one byte at a time to anyone
 * who can measure it.
 */
export function verifyHubRequest(input: {
  secrets: string[]
  timestamp: string | null
  requestId: string | null
  signature: string | null
  body: string
  now?: number
}): VerifyResult {
  const { timestamp, requestId, signature } = input
  if (!timestamp || !requestId || !signature) return { ok: false, reason: 'missing_headers' }

  const ts = Number(timestamp)
  if (!Number.isInteger(ts) || ts <= 0) return { ok: false, reason: 'bad_timestamp' }

  /*
    Absolute, so a clock running FAST is refused as firmly as one running slow.
    A future timestamp is not harmless: it would let a captured request stay
    valid long after it was taken.
  */
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000)
  if (Math.abs(nowSeconds - ts) > HUB_CLOCK_SKEW_SECONDS) return { ok: false, reason: 'stale' }

  if (!UUID.test(requestId)) return { ok: false, reason: 'bad_request_id' }
  if (input.secrets.length === 0) return { ok: false, reason: 'no_secret' }

  const offered = Buffer.from(signature, 'hex')
  let matched = false
  for (const secret of input.secrets) {
    const expected = Buffer.from(hubSignature(secret, ts, requestId, input.body), 'hex')
    /* Length is checked first because timingSafeEqual THROWS on a mismatch
       rather than returning false, and a thrown error here would be a 500 on
       a request that is simply forged. */
    if (offered.length === expected.length && timingSafeEqual(offered, expected)) {
      matched = true
    }
  }

  if (!matched) return { ok: false, reason: 'bad_signature' }
  return { ok: true, timestamp: ts, requestId }
}
