import { describe, expect, it } from 'vitest'

import {
  contactLine,
  formatPhone,
  isSyntheticEmail,
  maskPhone,
  normalisePhone,
  syntheticEmail,
  visibleEmail,
} from '../../src/lib/auth/phone'

/**
 * The phone is the sign-in since 2026-09-27, so the ways one number can be
 * written must all collapse to ONE string. Two spellings of the same line
 * would be two accounts, and the unique index on verified phones compares
 * exactly what `normalisePhone` produces (as does `public.normalise_phone`).
 */
describe('one number, one spelling', () => {
  it.each(['0241234567', '024 123 4567', '024-123-4567', '+233241234567', '233 24 123 4567', '+233 24 123 4567'])(
    '%s becomes 0241234567',
    (input) => {
      expect(normalisePhone(input)).toBe('0241234567')
    },
  )

  it('masks all but the prefix and the last four', () => {
    expect(maskPhone('+233241234567')).toBe('024 *** 4567')
  })

  it('formats for the owner', () => {
    expect(formatPhone('0241234567')).toBe('024 123 4567')
  })
})

describe('the generated email underneath a phone-only account', () => {
  it('is on our own domain and never contains the phone', () => {
    const email = syntheticEmail()
    expect(isSyntheticEmail(email)).toBe(true)
    expect(email).toMatch(/^m-[0-9a-f]{18}@members\.sideperks\.org$/)
  })

  it('is different every time', () => {
    expect(syntheticEmail()).not.toBe(syntheticEmail())
  })

  it('is never shown to a person, while a real address is', () => {
    expect(visibleEmail(syntheticEmail())).toBeNull()
    expect(visibleEmail('ama@example.com')).toBe('ama@example.com')
  })

  it('gives staff the phone instead', () => {
    expect(contactLine(syntheticEmail(), '0241234567')).toBe('024 123 4567')
    expect(contactLine('ama@example.com', '0241234567')).toBe('ama@example.com')
    expect(contactLine(syntheticEmail(), null)).toBe('')
  })
})
