import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * What the upgrade page asks before it offers to take money.
 *
 * WHY THIS FILE EXISTS. The gate on the plan checkout button and the coupon
 * field was `Boolean(serverEnv().PAYSTACK_SECRET_KEY)`. That was the right
 * question while this app charged the card itself and stopped being the right
 * question the day plans moved to the Tech Store hub, where this app holds no
 * Paystack key and makes no Paystack call.
 *
 * It became dangerous on 17 September 2026, when the live keys arrived and the
 * decision was taken to leave this app keyless, because a live Paystack
 * request from here would carry sideperks.org into the one place nothing may
 * reveal SidePerks. Removing the variable is correct and it would have hidden
 * the pay button on every plan, with no error, no log and a checkout that
 * simply says "not yet".
 *
 * So the gate now names the hub. These tests pin the four combinations,
 * including the one the fix exists for: no Paystack key at all, and plans
 * still on sale.
 *
 * `vi.resetModules()` before each import because `serverEnv()` memoises on
 * first call, so a second case in the same module instance would read the
 * first case's environment.
 */

const ENV_KEYS = ['TECHSTORE_HUB_URL', 'HUB_OUTBOUND_SECRETS', 'PAYSTACK_SECRET_KEY'] as const

async function gateWith(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<boolean> {
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) vi.stubEnv(key, '')
    else vi.stubEnv(key, env[key]!)
  }
  vi.resetModules()
  const { hubConfigured } = await import('@/lib/env')
  return hubConfigured()
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('the plan checkout gate', () => {
  it('is open with the hub configured and NO Paystack key, which is production', async () => {
    expect(
      await gateWith({
        TECHSTORE_HUB_URL: 'https://techstoreghana.com',
        HUB_OUTBOUND_SECRETS: 'a'.repeat(64),
      }),
    ).toBe(true)
  })

  it('is shut by a Paystack key alone: that key buys a Vault deposit, not a plan', async () => {
    expect(await gateWith({ PAYSTACK_SECRET_KEY: 'sk_live_notacheckout' })).toBe(false)
  })

  it('is shut without the hub URL, rather than sending a buyer to undefined', async () => {
    expect(await gateWith({ HUB_OUTBOUND_SECRETS: 'a'.repeat(64) })).toBe(false)
  })

  it('is shut when the secret list holds nothing but separators', async () => {
    expect(
      await gateWith({ TECHSTORE_HUB_URL: 'https://techstoreghana.com', HUB_OUTBOUND_SECRETS: ' , ' }),
    ).toBe(false)
  })
})
