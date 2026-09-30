import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifying a PayLink IPN.
 *
 *   x-gateway-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * Byte for byte the scheme in PayLink's own `src/lib/ipn/signature.ts`, with
 * one addition: several secrets, newest first, so the secret can be rotated
 * without a window where genuine IPNs are refused.
 *
 * The body must be the RAW request text. Re-serialising parsed JSON changes
 * the bytes and nothing would ever verify.
 */

export const PAYLINK_SIGNATURE_HEADER = 'x-gateway-signature'

/** PayLink's own tolerance. Older than this and a captured IPN is not replayable. */
export const PAYLINK_MAX_AGE_SECONDS = 300

export type PaylinkVerifyResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: 'no_secret' | 'malformed' | 'expired' | 'mismatch' }

export function verifyPaylinkSignature(input: {
  secrets: string[]
  rawBody: string
  header: string | null
  /** Unix seconds. Only tests pass it. */
  now?: number
}): PaylinkVerifyResult {
  if (input.secrets.length === 0) return { ok: false, reason: 'no_secret' }

  const parts = Object.fromEntries(
    (input.header ?? '').split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  ) as Record<string, string | undefined>

  const t = Number(parts.t)
  const v1 = parts.v1 ?? ''
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) return { ok: false, reason: 'malformed' }

  const now = input.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - t) > PAYLINK_MAX_AGE_SECONDS) return { ok: false, reason: 'expired' }

  const given = Buffer.from(v1, 'hex')
  for (const secret of input.secrets) {
    const expected = createHmac('sha256', secret).update(`${t}.${input.rawBody}`, 'utf8').digest()
    // Both are 32 bytes: the regex above guarantees 64 hex characters.
    if (timingSafeEqual(expected, given)) return { ok: true, timestamp: t }
  }
  return { ok: false, reason: 'mismatch' }
}

/** Only for tests: what PayLink would send. */
export function signPaylinkBody(secret: string, rawBody: string, timestamp: number): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  return `t=${timestamp},v1=${mac}`
}
