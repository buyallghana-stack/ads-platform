import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which product a hub reference buys.
 *
 * One endpoint settles both businesses now: a plan in `subscription_payments`
 * and a Vault deposit in `vault_payments`. The reference is the only thing that
 * says which, and getting it wrong is not a cosmetic fault. Sending a vault
 * deposit to `confirm_subscription_payment` raises on a payment that was really
 * paid for; sending a plan to `confirm_vault_payment` would open an investment
 * that pays points out every day for money that bought a plan.
 *
 * So every assertion here is about WHICH RPC was called. The amounts are the
 * same in both cases on purpose: the guards are pinned in `hub-amount-guard`
 * and `hub-fulfilment`, and nothing about them may depend on the kind.
 */

vi.mock('server-only', () => ({}))

const rpc = vi.fn()
const subscriptionRow = vi.fn()
const vaultRow = vi.fn()
const configRow = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle:
            table === 'app_config'
              ? configRow
              : table === 'vault_payments'
                ? vaultRow
                : subscriptionRow,
        }),
      }),
    }),
    rpc,
  }),
}))

const { applyHubEvent } = await import('@/lib/payments/hub/fulfil')

const REFERENCE = 'TS-11D4E9A0C332'
const EMPTY = { data: null, error: null }

const row = (id: string, over: Record<string, unknown> = {}) => ({
  data: { id, status: 'pending', amount_minor: 30000, currency_code: 'GHS', ...over },
  error: null,
})

/** A reference only the vault table knows. */
const vaultOnly = (over: Record<string, unknown> = {}) => {
  subscriptionRow.mockResolvedValue(EMPTY)
  vaultRow.mockResolvedValue(row('vault-pay-1', over))
}

/** A reference only the subscription table knows. */
const subscriptionOnly = (over: Record<string, unknown> = {}) => {
  subscriptionRow.mockResolvedValue(row('sub-pay-1', over))
  vaultRow.mockResolvedValue(EMPTY)
}

const names = () => rpc.mock.calls.map(([name]) => name as string)

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({ error: null })
  configRow.mockResolvedValue({ data: { value: 'false' }, error: null })
})

describe('a deposit the vault table carries', () => {
  beforeEach(vaultOnly)

  it('is confirmed as a vault payment, never as a plan', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 30000,
      currency: 'GHS',
    })

    expect(outcome).toMatchObject({ ok: true, state: 'confirmed', kind: 'vault' })
    expect(names()).toEqual(['confirm_vault_payment'])
  })

  it('is failed as a vault payment', async () => {
    const outcome = await applyHubEvent({ event: 'payment.failed', reference: REFERENCE })

    expect(outcome).toMatchObject({ ok: true, state: 'failed', kind: 'vault' })
    expect(names()).toEqual(['fail_vault_payment'])
  })

  it('is reversed as a vault payment', async () => {
    const outcome = await applyHubEvent({ event: 'payment.reversed', reference: REFERENCE })

    expect(outcome).toMatchObject({ ok: true, state: 'reversed', kind: 'vault' })
    expect(names()).toEqual(['reverse_vault_payment'])
  })

  it('is weighed for the money exactly as a plan is', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 1000,
      currency: 'GHS',
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'mismatch', kind: 'vault' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('is refused on test money exactly as a plan is', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 30000,
      currency: 'GHS',
      payload: { domain: 'test' },
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'test_mode', kind: 'vault' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('a plan, now that a second table exists', () => {
  beforeEach(subscriptionOnly)

  it('still goes to the subscription RPC and never reaches the vault', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 30000,
      currency: 'GHS',
    })

    expect(outcome).toMatchObject({ ok: true, kind: 'subscription' })
    expect(names()).toEqual(['confirm_subscription_payment'])
  })

  it('costs no extra lookup, because subscriptions are asked first', async () => {
    await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 30000,
      currency: 'GHS',
    })

    expect(vaultRow).not.toHaveBeenCalled()
  })
})

describe('a reference in neither table', () => {
  it('is not found, and touches nothing', async () => {
    subscriptionRow.mockResolvedValue(EMPTY)
    vaultRow.mockResolvedValue(EMPTY)

    expect(
      await applyHubEvent({
        event: 'payment.success',
        reference: 'TS-NOTOURS',
        amountMinor: 30000,
        currency: 'GHS',
      }),
    ).toEqual({ ok: false, reason: 'not_found' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
