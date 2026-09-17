import { describe, expect, it } from 'vitest'

import {
  checkSuccessAmount,
  paystackMode,
  readCurrency,
  readMinorUnits,
} from '@/lib/payments/hub/decide'

/**
 * The two questions asked before a plan is granted: whose money, and how much.
 *
 * WHY THIS FILE EXISTS. The Tech Store wrote on 17 September 2026 with two
 * things. Their amount guard had required only that both figures were finite
 * numbers, and `Number("")` and `Number(null)` are both `0`, so two MISSING
 * amounts compared equal and read as a match. And their Paystack account had
 * been in test mode in production from the start, so six SidePerks payments
 * were reported successful, signed correctly, and granted plans against no
 * money at all.
 *
 * Ours could not fail their way, because `subscription_payments.amount_minor`
 * is `not null check (> 0)`. It failed the other way instead: when the hub
 * stated no amount, the expected figure was compared against ITSELF and the
 * plan was granted with no check performed. A skipped check and a passed check
 * look identical from outside, which is why this file exercises absence in
 * every form it can arrive in rather than only wrong numbers.
 *
 * Pure. No database, no network, no environment.
 */

const EXPECTED = { expectedMinor: 52000, expectedCurrency: 'GHS' }

describe('reading an amount', () => {
  it('accepts a positive whole number of minor units', () => {
    expect(readMinorUnits(52000)).toBe(52000)
    expect(readMinorUnits('52000')).toBe(52000)
    expect(readMinorUnits(1)).toBe(1)
  })

  /* `bigint` comes back from PostgREST as a string often enough that this is
     the ordinary case, not the exotic one. */
  it('accepts the string a bigint column arrives as', () => {
    expect(readMinorUnits(' 52000 ')).toBe(52000)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['zero', 0],
    ['zero as a string', '0'],
    ['a negative', -52000],
    ['a float', 520.5],
    ['a float as a string', '520.5'],
    ['not a number at all', 'five hundred'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('refuses %s', (_label, value) => {
    expect(readMinorUnits(value)).toBeNull()
  })

  /*
    ⚠️ THE ONES `Number` LIES ABOUT. Every value here is truthy-looking
    nonsense that `Number` turns into a plausible integer: `[]` and `false`
    become 0, `true` becomes 1, `[52000]` becomes 52000. A guard that coerces
    first and range-checks afterwards accepts all four. This is exactly the
    shape of the fault the Tech Store found in their own code.
  */
  it.each([
    ['an empty array', []],
    ['an array holding the amount', [52000]],
    ['false', false],
    ['true', true],
    ['an object', { amount: 52000 }],
  ])('refuses %s, which Number() would happily coerce', (_label, value) => {
    expect(readMinorUnits(value)).toBeNull()
  })
})

describe('reading a currency', () => {
  it('accepts a three letter code and normalises it', () => {
    expect(readCurrency('ghs')).toBe('GHS')
    /* `currency_code` is `char(3)`, so a row read can arrive padded. */
    expect(readCurrency('GHS ')).toBe('GHS')
  })

  it.each([['null', null], ['empty', ''], ['too short', 'GH'], ['too long', 'GHSX'], ['digits', '123']])(
    'refuses %s',
    (_label, value) => {
      expect(readCurrency(value)).toBeNull()
    },
  )
})

describe('checking what the hub says was paid', () => {
  it('passes when the figures agree', () => {
    expect(
      checkSuccessAmount({ ...EXPECTED, statedMinor: 52000, statedCurrency: 'GHS' }),
    ).toEqual({ ok: true, minor: 52000, currency: 'GHS' })
  })

  it('passes when the hub sends the amount as a string', () => {
    expect(
      checkSuccessAmount({ ...EXPECTED, statedMinor: '52000', statedCurrency: 'ghs' }),
    ).toMatchObject({ ok: true })
  })

  it('refuses a different amount', () => {
    const verdict = checkSuccessAmount({ ...EXPECTED, statedMinor: 100, statedCurrency: 'GHS' })
    expect(verdict.ok).toBe(false)
    /* Pesewas in the comparison, CEDIS in the sentence. An admin reading
       "Expected 52000 GHS" is reading a number a hundred times too big on the
       one line that decides whether a payment is wrong. */
    expect(verdict).toMatchObject({
      detail: 'Expected GHS 520.00, the hub reported GHS 1.00',
    })
  })

  it('refuses a different currency at the same figure', () => {
    expect(
      checkSuccessAmount({ ...EXPECTED, statedMinor: 52000, statedCurrency: 'USD' }),
    ).toMatchObject({ ok: false })
  })

  /*
    THE REGRESSION THIS FILE WAS WRITTEN FOR.

    `Number(input.amountMinor ?? expected)` compared the expectation against
    itself whenever the hub stated nothing, so every one of these granted a
    plan without a single figure being checked.
  */
  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['an empty string', ''],
    ['zero', 0],
  ])('refuses a success stating %s as the amount', (_label, stated) => {
    const verdict = checkSuccessAmount({ ...EXPECTED, statedMinor: stated, statedCurrency: 'GHS' })
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({
      detail: expect.stringContaining('without an amount'),
    })
  })

  it('refuses a success stating no currency', () => {
    const verdict = checkSuccessAmount({ ...EXPECTED, statedMinor: 52000, statedCurrency: null })
    expect(verdict).toMatchObject({ detail: expect.stringContaining('without a currency') })
  })

  it('names both when both are missing, rather than reporting GHS 0.00', () => {
    const verdict = checkSuccessAmount({ ...EXPECTED, statedMinor: null, statedCurrency: null })
    expect(verdict).toMatchObject({
      detail: expect.stringContaining('without an amount or a currency'),
    })
  })

  /* The Tech Store's own fault, tested from our side: two absences must never
     agree with each other. The column makes this unreachable and the check is
     here anyway, because "unreachable" is a claim about today's schema. */
  it('refuses when NEITHER side has an amount', () => {
    expect(
      checkSuccessAmount({
        expectedMinor: null,
        expectedCurrency: 'GHS',
        statedMinor: null,
        statedCurrency: 'GHS',
      }),
    ).toMatchObject({ ok: false, detail: expect.stringContaining('no readable amount') })
  })

  it('refuses when neither side has an amount and both coerce to zero', () => {
    expect(
      checkSuccessAmount({
        expectedMinor: '',
        expectedCurrency: 'GHS',
        statedMinor: '',
        statedCurrency: 'GHS',
      }),
    ).toMatchObject({ ok: false })
  })
})

describe('telling test money from real money', () => {
  it('reads the field the hub would send at the top level', () => {
    expect(paystackMode({ event: 'payment.success', domain: 'test' })).toBe('test')
    expect(paystackMode({ event: 'payment.success', domain: 'live' })).toBe('live')
  })

  it('reads it wherever the hub chooses to nest it', () => {
    expect(paystackMode({ data: { domain: 'test' } })).toBe('test')
    expect(paystackMode({ paystack_payload: { domain: 'live' } })).toBe('live')
    expect(paystackMode({ provider_payload: { domain: 'test' } })).toBe('test')
  })

  it('does not care about case or padding', () => {
    expect(paystackMode({ domain: ' TEST ' })).toBe('test')
  })

  /*
    ⚠️ ABSENCE IS PERMISSIVE, ON PURPOSE. `domain` is not in the hub contract
    and the hub does not forward it today, so every real event reads `unknown`.
    Making absence fatal would refuse every genuine payment in order to catch a
    case we cannot yet see. The day the field arrives, the guard is already
    here. Until then this test is the record of a decision, not of a gap.
  */
  it.each([
    ['an empty payload', {}],
    ['no payload', undefined],
    ['null', null],
    ['a string', 'payment.success'],
    ['an unrecognised value', { domain: 'sandbox' }],
    ['the field nested out of reach', { a: { b: { domain: 'test' } } }],
  ])('answers unknown for %s', (_label, payload) => {
    expect(paystackMode(payload)).toBe('unknown')
  })

  it('is not fooled by an array where an object was expected', () => {
    expect(paystackMode([{ domain: 'test' }])).toBe('unknown')
  })
})
