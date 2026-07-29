import { describe, expect, it } from 'vitest'

import { positiveFinite, withinBounds } from '../../src/lib/pricing/validate'
import { HAS_DB, type Tx, expectRejection, setConfig, withRollback } from '../support/db'

/**
 * Crypto payout pricing.
 *
 * This replaced `const DEMO_GHS_PER_USD = 10.45` in the withdraw wizard, which
 * was about 12% adrift of the real rate and wrong in the direction that
 * promises more than the platform sends. The tests below are mostly about the
 * ways a rate can be absent or wrong, because the failure that matters is not
 * "the maths is off" — it is a number appearing on a withdrawal screen that no
 * source stands behind.
 */

describe('rate validation', () => {
  it('rejects everything that is not a positive finite number', () => {
    // CoinGecko answers an unsupported currency with HTTP 200 and the field
    // simply missing — `{"tether":{}}`. Reproduced against the live API. So
    // `undefined` here is not a hypothetical, it is the documented response.
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, 0, -1, '', 'abc', {}, []]) {
      expect(positiveFinite(bad), `${JSON.stringify(bad)} should be rejected`).toBeNull()
    }
  })

  it('accepts real rates, including numeric strings', () => {
    expect(positiveFinite(11.677728)).toBe(11.677728)
    expect(positiveFinite('0.998795')).toBe(0.998795)
  })

  it('refuses a real number that is an absurd rate', () => {
    // A feed with the decimal point in the wrong place returns a perfectly
    // valid number. Bounds are the only thing that catches it.
    expect(withinBounds('USD_GHS', 11.68)).toBe(true)
    expect(withinBounds('USD_GHS', 0.5)).toBe(false)
    expect(withinBounds('USD_GHS', 1168)).toBe(false)

    expect(withinBounds('USDT_USD', 0.9988)).toBe(true)
    expect(withinBounds('USDT_USD', 11.68)).toBe(false)
  })

  it('lets an unknown pair through rather than inventing a bound for it', () => {
    expect(withinBounds('ETH_USD', 3400)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

const putRate = (tx: Tx, pair: string, rate: number, ageHours = 0) =>
  tx.query(
    `insert into public.fx_rates (pair, rate, source, fetched_at)
     values ($1, $2, 'test', now() - make_interval(hours => $3::int))
     on conflict (pair) do update
       set rate = excluded.rate, fetched_at = excluded.fetched_at`,
    [pair, rate, ageHours],
  )

async function quote(tx: Tx, ghs: number, coin: string) {
  const { rows } = await tx.query(`select public.quote_crypto_payout($1, $2) as q`, [ghs, coin])
  return rows[0]!.q as Record<string, number | string> | null
}

describe.skipIf(!HAS_DB)('quoting a crypto payout', () => {
  it('converts through USD using both legs', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'crypto_payout_spread_percent', '0')
      await putRate(tx, 'USD_GHS', 11.68)
      await putRate(tx, 'USDT_USD', 0.998)

      const q = await quote(tx, 116.8, 'USDT')

      // 116.80 / 11.68 = 10 USD; 10 / 0.998 = 10.0200… USDT
      expect(Number(q!.usd_amount)).toBeCloseTo(10, 2)
      expect(Number(q!.coin_amount)).toBeCloseTo(10.0200, 3)
      expect(q!.coin).toBe('USDT')
    })
  })

  it('does not assume a stablecoin is worth exactly a dollar', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'crypto_payout_spread_percent', '0')
      await putRate(tx, 'USD_GHS', 11.68)
      await putRate(tx, 'USDC_USD', 0.95) // a depeg, to make the difference visible

      const q = await quote(tx, 116.8, 'USDC')
      expect(Number(q!.coin_amount)).toBeCloseTo(10.5263, 3)
    })
  })

  it('applies the operator spread', async () => {
    await withRollback(async (tx) => {
      await putRate(tx, 'USD_GHS', 11.68)
      await putRate(tx, 'USDT_USD', 1)

      await setConfig(tx, 'crypto_payout_spread_percent', '0')
      const none = Number((await quote(tx, 116.8, 'USDT'))!.coin_amount)

      await setConfig(tx, 'crypto_payout_spread_percent', '2')
      const withSpread = Number((await quote(tx, 116.8, 'USDT'))!.coin_amount)

      expect(none).toBeCloseTo(10, 3)
      expect(withSpread).toBeCloseTo(9.8, 3)
    })
  })

  it('reports the age of the STALER leg, not the fresher one', async () => {
    await withRollback(async (tx) => {
      await putRate(tx, 'USD_GHS', 11.68, 10) // ten hours old
      await putRate(tx, 'USDT_USD', 1, 0) // just now

      const q = await quote(tx, 100, 'USDT')
      const age = (Date.now() - new Date(q!.quoted_at as string).getTime()) / 3_600_000
      expect(age).toBeGreaterThan(9)
    })
  })
})

describe.skipIf(!HAS_DB)('refusing to quote', () => {
  it('returns null when a leg has never been fetched', async () => {
    await withRollback(async (tx) => {
      await tx.query(`delete from public.fx_rates`)
      await putRate(tx, 'USD_GHS', 11.68)
      // No USDT_USD at all.
      expect(await quote(tx, 100, 'USDT')).toBeNull()
    })
  })

  it('returns null when either leg is older than the tolerance', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'fx_rate_max_age_hours', '36')

      await putRate(tx, 'USD_GHS', 11.68, 0)
      await putRate(tx, 'USDT_USD', 1, 48)
      expect(await quote(tx, 100, 'USDT'), 'stale coin leg').toBeNull()

      await putRate(tx, 'USD_GHS', 11.68, 48)
      await putRate(tx, 'USDT_USD', 1, 0)
      expect(await quote(tx, 100, 'USDT'), 'stale fiat leg').toBeNull()
    })
  })

  it('returns null for a coin nobody has a rate for', async () => {
    await withRollback(async (tx) => {
      await putRate(tx, 'USD_GHS', 11.68)
      expect(await quote(tx, 100, 'DOGE')).toBeNull()
    })
  })

  it('returns null for a nonsense amount rather than a nonsense quote', async () => {
    await withRollback(async (tx) => {
      await putRate(tx, 'USD_GHS', 11.68)
      await putRate(tx, 'USDT_USD', 1)

      expect(await quote(tx, 0, 'USDT')).toBeNull()
      expect(await quote(tx, -5, 'USDT')).toBeNull()
    })
  })
})

describe.skipIf(!HAS_DB)('storing a rate', () => {
  it('refuses a rate that is not a positive number', async () => {
    await withRollback(async (tx) => {
      for (const bad of [0, -1]) {
        const message = await expectRejection(tx, () =>
          tx.query(`select public.set_fx_rate('USD_GHS', $1, 'test')`, [bad]),
        )
        expect(message).toMatch(/positive finite/i)
      }
    })
  })

  it('overwrites in place and moves fetched_at forward', async () => {
    await withRollback(async (tx) => {
      await putRate(tx, 'USD_GHS', 10.45, 40) // the old hardcoded value, gone stale
      expect(await quote(tx, 100, 'USDT')).toBeNull()

      await tx.query(`select public.set_fx_rate('USD_GHS', 11.68, 'open.er-api.com')`)
      await putRate(tx, 'USDT_USD', 1)

      const { rows } = await tx.query(
        `select rate, source from public.fx_rates where pair = 'USD_GHS'`,
      )
      expect(Number(rows[0]!.rate)).toBe(11.68)
      expect(rows[0]!.source).toBe('open.er-api.com')
      expect(await quote(tx, 100, 'USDT')).not.toBeNull()
    })
  })

  it('is not reachable by a signed-in user', async () => {
    await withRollback(async (tx) => {
      // The rate decides what a withdrawal is worth. Reading it is fine —
      // the screen shows it — but writing it must be the cron alone.
      const { rows } = await tx.query(
        `select has_function_privilege('authenticated',
           'public.set_fx_rate(text, numeric, text)', 'execute') as can`,
      )
      expect(rows[0]!.can).toBe(false)
    })
  })
})
