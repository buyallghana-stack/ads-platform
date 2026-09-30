import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { amountToPesewas, cedisToAmount, pesewasToAmount } from '@/lib/payments/paylink/money'
import {
  PAYLINK_MAX_AGE_SECONDS,
  signPaylinkBody,
  verifyPaylinkSignature,
} from '@/lib/payments/paylink/signature'

/**
 * The two things between PayLink and this app's money that need no database:
 * whether an IPN really came from PayLink, and how an amount crosses the wire.
 *
 * Pure, so these run everywhere, including on a machine with no Supabase
 * credentials.
 */

const SECRET = 'ipn_a-secret-that-is-long-enough-to-be-real'
const OLDER = 'ipn_the-previous-secret-still-in-rotation'
const NOW = 1_790_000_000
const BODY = '{"event_id":"c0a8","type":"payment.updated","livemode":false,"data":{"status":"finished"}}'

const verify = (over: Partial<Parameters<typeof verifyPaylinkSignature>[0]> = {}) =>
  verifyPaylinkSignature({
    secrets: [SECRET],
    rawBody: BODY,
    header: signPaylinkBody(SECRET, BODY, NOW),
    now: NOW,
    ...over,
  })

describe('PayLink IPN signatures', () => {
  it('accepts what PayLink signed', () => {
    expect(verify()).toEqual({ ok: true, timestamp: NOW })
  })

  /*
    A literal, computed by hand from PayLink's documented scheme:
    hex HMAC-SHA256 of "<t>.<raw body>". If this app's signer and verifier
    drifted together from PayLink's, every other test here would still pass.
  */
  it('matches the documented scheme byte for byte', () => {
    const mac = createHmac('sha256', SECRET).update(`${NOW}.${BODY}`, 'utf8').digest('hex')
    expect(signPaylinkBody(SECRET, BODY, NOW)).toBe(`t=${NOW},v1=${mac}`)
    expect(verify({ header: `t=${NOW},v1=${mac}` }).ok).toBe(true)
  })

  it('refuses a body changed by one byte', () => {
    expect(verify({ rawBody: BODY.replace('finished', 'finishes') })).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('refuses a body that was re-serialised', () => {
    // Same JSON, different bytes: the reason the route reads the RAW body.
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 1)
    expect(verify({ rawBody: reserialised })).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('refuses the wrong secret', () => {
    expect(verify({ secrets: ['ipn_somebody-elses-secret'] })).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('accepts the older secret during a rotation', () => {
    expect(verify({ secrets: [SECRET, OLDER], header: signPaylinkBody(OLDER, BODY, NOW) }).ok).toBe(true)
  })

  it('refuses a timestamp outside five minutes either way', () => {
    const old = signPaylinkBody(SECRET, BODY, NOW - PAYLINK_MAX_AGE_SECONDS - 1)
    const future = signPaylinkBody(SECRET, BODY, NOW + PAYLINK_MAX_AGE_SECONDS + 1)
    expect(verify({ header: old })).toEqual({ ok: false, reason: 'expired' })
    expect(verify({ header: future })).toEqual({ ok: false, reason: 'expired' })
    expect(verify({ header: signPaylinkBody(SECRET, BODY, NOW - PAYLINK_MAX_AGE_SECONDS) }).ok).toBe(true)
  })

  it('refuses a missing or malformed header', () => {
    expect(verify({ header: null })).toEqual({ ok: false, reason: 'malformed' })
    expect(verify({ header: `t=${NOW}` })).toEqual({ ok: false, reason: 'malformed' })
    expect(verify({ header: `t=${NOW},v1=zz` })).toEqual({ ok: false, reason: 'malformed' })
    expect(verify({ header: `t=soon,v1=${'a'.repeat(64)}` })).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses everything when no secret is configured', () => {
    expect(verify({ secrets: [] })).toEqual({ ok: false, reason: 'no_secret' })
  })
})

describe('PayLink amounts', () => {
  it('writes pesewas as a two-decimal cedi string', () => {
    expect(pesewasToAmount(52000)).toBe('520.00')
    expect(pesewasToAmount('52050')).toBe('520.50')
    expect(pesewasToAmount(5)).toBe('0.05')
    expect(pesewasToAmount(BigInt(123456789))).toBe('1234567.89')
  })

  it('refuses a price that is not a positive whole number of pesewas', () => {
    expect(pesewasToAmount(0)).toBeNull()
    expect(pesewasToAmount(-100)).toBeNull()
    expect(pesewasToAmount(100.5)).toBeNull()
    expect(pesewasToAmount('abc')).toBeNull()
  })

  it('reads PayLink amounts back into pesewas without a float', () => {
    expect(amountToPesewas('150.00')).toBe(BigInt(15000))
    expect(amountToPesewas('150')).toBe(BigInt(15000))
    expect(amountToPesewas('150.5')).toBe(BigInt(15050))
    // The case a float gets wrong: 0.1 + 0.2.
    expect(amountToPesewas('0.30')).toBe(BigInt(30))
  })

  it('refuses anything it cannot read exactly', () => {
    for (const bad of ['150.001', '-1.00', '1e3', '', ' ', '150,00', null, 150, undefined]) {
      expect(amountToPesewas(bad)).toBeNull()
    }
  })

  it('formats a numeric(18,2) from the database as PayLink expects', () => {
    expect(cedisToAmount('12.5')).toBe('12.50')
    expect(cedisToAmount('12.50')).toBe('12.50')
    expect(cedisToAmount(12.5)).toBe('12.50')
    expect(cedisToAmount(10)).toBe('10.00')
    expect(cedisToAmount('12.505')).toBeNull()
    expect(cedisToAmount(null)).toBeNull()
  })
})
