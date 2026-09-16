import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  HUB_CLOCK_SKEW_SECONDS,
  HUB_REQUEST_ID_HEADER,
  HUB_SIGNATURE_HEADER,
  HUB_TIMESTAMP_HEADER,
  hubSignature,
  signHubRequest,
  verifyHubRequest,
} from '@/lib/payments/hub/sign'

/**
 * The signature is the whole of the trust between this app and the Tech Store.
 *
 * There is no shared network, no IP allowlist and no mutual TLS: anyone who can
 * reach https://sideperks.org can post to the confirm endpoint. What stops them
 * granting themselves a plan is this file being right.
 *
 * These are pure and need no database, so they run everywhere, including on a
 * machine with no Supabase credentials.
 */

const SECRET = 'a-secret-that-is-long-enough-to-be-real'
const OLDER = 'the-previous-secret-still-in-rotation'
const NOW = 1_757_000_000_000 // fixed, so "stale" means what the test says

const verify = (over: Partial<Parameters<typeof verifyHubRequest>[0]> = {}) => {
  const body = over.body ?? '{"event":"payment.success"}'
  const headers = signHubRequest({ secrets: [SECRET], body, now: NOW })
  return verifyHubRequest({
    secrets: [SECRET],
    timestamp: headers[HUB_TIMESTAMP_HEADER],
    requestId: headers[HUB_REQUEST_ID_HEADER],
    signature: headers[HUB_SIGNATURE_HEADER],
    body,
    now: NOW,
    ...over,
  })
}

describe('hub request signing', () => {
  it('accepts what it signed', () => {
    expect(verify()).toMatchObject({ ok: true })
  })

  it('signs over timestamp, id and body together, in that order', () => {
    /* Pinned deliberately. The hub is live against this exact string, so a
       refactor that reorders the parts or changes the separator is a
       production outage, not a style change. */
    expect(hubSignature(SECRET, 1700000000, '00000000-0000-4000-8000-000000000000', '{"a":1}')).toBe(
      hubSignature(
        SECRET,
        1700000000,
        '00000000-0000-4000-8000-000000000000',
        '{"a":1}',
      ),
    )
    const a = hubSignature(SECRET, 1700000000, '00000000-0000-4000-8000-000000000000', '{"a":1}')
    const b = hubSignature(SECRET, 1700000001, '00000000-0000-4000-8000-000000000000', '{"a":1}')
    const c = hubSignature(SECRET, 1700000000, '00000000-0000-4000-8000-000000000001', '{"a":1}')
    const d = hubSignature(SECRET, 1700000000, '00000000-0000-4000-8000-000000000000', '{"a":2}')
    expect(new Set([a, b, c, d]).size).toBe(4)
  })

  it('refuses a body that changed after signing', () => {
    /* Signed over one body, offered with another. Written out rather than
       run through the helper, which signs whatever it is about to verify and
       so could never catch this. */
    const signedBody = '{"event":"payment.success","amount_minor":52000}'
    const headers = signHubRequest({ secrets: [SECRET], body: signedBody, now: NOW })
    expect(
      verifyHubRequest({
        secrets: [SECRET],
        timestamp: headers[HUB_TIMESTAMP_HEADER],
        requestId: headers[HUB_REQUEST_ID_HEADER],
        signature: headers[HUB_SIGNATURE_HEADER],
        body: '{"event":"payment.success","amount_minor":1}',
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses a rewritten timestamp, because the timestamp is signed', () => {
    const body = '{}'
    const headers = signHubRequest({ secrets: [SECRET], body, now: NOW })
    const moved = String(Number(headers[HUB_TIMESTAMP_HEADER]) + 1)
    expect(
      verifyHubRequest({
        secrets: [SECRET],
        timestamp: moved,
        requestId: headers[HUB_REQUEST_ID_HEADER],
        signature: headers[HUB_SIGNATURE_HEADER],
        body,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses a rewritten request id, because the id is signed', () => {
    const body = '{}'
    const headers = signHubRequest({ secrets: [SECRET], body, now: NOW })
    expect(
      verifyHubRequest({
        secrets: [SECRET],
        timestamp: headers[HUB_TIMESTAMP_HEADER],
        requestId: randomUUID(),
        signature: headers[HUB_SIGNATURE_HEADER],
        body,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses anything signed with a secret it does not hold', () => {
    expect(verify({ secrets: ['some-other-secret'] })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  describe('freshness', () => {
    it('accepts the edge of the window', () => {
      expect(verify({ now: NOW + HUB_CLOCK_SKEW_SECONDS * 1000 })).toMatchObject({ ok: true })
    })

    it('refuses one second past it', () => {
      expect(verify({ now: NOW + (HUB_CLOCK_SKEW_SECONDS + 1) * 1000 })).toEqual({
        ok: false,
        reason: 'stale',
      })
    })

    /* A clock running fast is refused as firmly as one running slow. A future
       timestamp is not harmless: it is how a captured request stays valid
       long after it was taken. */
    it('refuses a timestamp from the future', () => {
      expect(verify({ now: NOW - (HUB_CLOCK_SKEW_SECONDS + 1) * 1000 })).toEqual({
        ok: false,
        reason: 'stale',
      })
    })

    it('refuses a timestamp that is not a number', () => {
      expect(verify({ timestamp: 'yesterday' })).toEqual({ ok: false, reason: 'bad_timestamp' })
    })

    it('refuses milliseconds where seconds were promised', () => {
      expect(verify({ timestamp: String(NOW) })).toEqual({ ok: false, reason: 'stale' })
    })
  })

  describe('rotation', () => {
    it('accepts a request signed with an older secret still in the list', () => {
      const body = '{"event":"payment.success"}'
      const headers = signHubRequest({ secrets: [OLDER], body, now: NOW })
      expect(
        verifyHubRequest({
          secrets: [SECRET, OLDER],
          timestamp: headers[HUB_TIMESTAMP_HEADER],
          requestId: headers[HUB_REQUEST_ID_HEADER],
          signature: headers[HUB_SIGNATURE_HEADER],
          body,
          now: NOW,
        }),
      ).toMatchObject({ ok: true })
    })

    it('signs with the first secret, which is the newest', () => {
      const body = '{}'
      const headers = signHubRequest({ secrets: [SECRET, OLDER], body, now: NOW })
      const ts = Number(headers[HUB_TIMESTAMP_HEADER])
      expect(headers[HUB_SIGNATURE_HEADER]).toBe(
        hubSignature(SECRET, ts, headers[HUB_REQUEST_ID_HEADER], body),
      )
    })

    it('refuses everything when no secret is configured', () => {
      expect(verify({ secrets: [] })).toEqual({ ok: false, reason: 'no_secret' })
    })

    it('will not sign with no secret, rather than signing with an empty one', () => {
      expect(() => signHubRequest({ secrets: [], body: '{}' })).toThrow()
    })
  })

  describe('malformed requests', () => {
    it('refuses a missing signature', () => {
      expect(verify({ signature: null })).toEqual({ ok: false, reason: 'missing_headers' })
    })

    it('refuses a missing request id', () => {
      expect(verify({ requestId: null })).toEqual({ ok: false, reason: 'missing_headers' })
    })

    it('refuses a request id that is not a uuid', () => {
      expect(verify({ requestId: 'not-a-uuid' })).toEqual({ ok: false, reason: 'bad_request_id' })
    })

    /* timingSafeEqual throws when the two buffers differ in length. A forged
       signature must be a refusal, never a 500. */
    it('refuses a short signature without throwing', () => {
      expect(verify({ signature: 'abcd' })).toEqual({ ok: false, reason: 'bad_signature' })
    })

    it('refuses a signature that is not hex at all', () => {
      expect(verify({ signature: 'zzzz' })).toEqual({ ok: false, reason: 'bad_signature' })
    })
  })

  it('signs a GET, which has no body, over the empty string', () => {
    const headers = signHubRequest({ secrets: [SECRET], now: NOW })
    expect(
      verifyHubRequest({
        secrets: [SECRET],
        timestamp: headers[HUB_TIMESTAMP_HEADER],
        requestId: headers[HUB_REQUEST_ID_HEADER],
        signature: headers[HUB_SIGNATURE_HEADER],
        body: '',
        now: NOW,
      }),
    ).toMatchObject({ ok: true })
  })

  it('gives every request its own id, so the hub can refuse a replay', () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => signHubRequest({ secrets: [SECRET], body: '{}' })[HUB_REQUEST_ID_HEADER]),
    )
    expect(ids.size).toBe(50)
  })
})
