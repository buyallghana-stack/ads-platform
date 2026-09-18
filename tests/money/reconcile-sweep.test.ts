import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sweep that rescues a payment nobody finished.
 *
 * ⚠️ WHY THIS FILE EXISTS. Two things have to go wrong at once for this route
 * to matter: the buyer closes the tab on the way back from the bank, so the
 * return page never runs, AND the hub's confirm POST never lands. The money
 * left the buyer either way, and this is the only thing that catches the pair.
 *
 * It listed `subscription_payments` alone until 18 September 2026, which was
 * right until the Vault moved onto the hub that day and wrong the moment it
 * did. `settleFromHub` handles a deposit perfectly well; nothing was ever going
 * to hand it one. A paid deposit would have sat `pending` for good, and the
 * failure is invisible: a stranded row looks exactly like a checkout somebody
 * abandoned.
 *
 * So what is pinned here is the LISTING, not the settling. The settling is one
 * shared idempotent path and is covered by `hub-fulfilment`,
 * `hub-status-values` and `vault-hub-settlement`.
 */

vi.mock('server-only', () => ({}))

const settleFromHub = vi.fn()
const applyHubEvent = vi.fn()
const asked: string[] = []
const tables: Record<string, unknown[]> = { subscription_payments: [], vault_payments: [] }

vi.mock('@/lib/env', () => ({ serverEnv: () => ({ CRON_SECRET: 'the-secret' }) }))
vi.mock('@/lib/observability/report', () => ({ reportUnexpected: vi.fn() }))
vi.mock('@/lib/payments/hub/resolve', () => ({ settleFromHub }))
vi.mock('@/lib/payments/hub/fulfil', () => ({ applyHubEvent }))

/* One chainable builder per table. Every link returns itself and the last one
   is awaited, which is what the route does. */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      asked.push(table)
      const builder: Record<string, unknown> = {}
      for (const link of ['select', 'eq', 'not', 'lt', 'order']) builder[link] = () => builder
      builder.limit = () => Promise.resolve({ data: tables[table] ?? [], error: null })
      return builder
    },
  }),
}))

const { GET } = await import('@/app/api/cron/reconcile-payments/route')

const ring = () =>
  GET(new Request('https://sideperks.org/api/cron/reconcile-payments', {
    headers: { authorization: 'Bearer the-secret' },
  }))

/** Older than the ten minute floor, so the sweep will actually pick it up. */
const strandedAt = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  asked.length = 0
  tables.subscription_payments = []
  tables.vault_payments = []
  settleFromHub.mockResolvedValue({ state: 'confirmed', kind: 'subscription' })
  applyHubEvent.mockResolvedValue({ ok: true })
})

describe('what the sweep looks at', () => {
  it('asks both tables, not just plans', async () => {
    await ring()

    expect(asked).toContain('subscription_payments')
    expect(asked).toContain('vault_payments')
  })

  it('settles a stranded Vault deposit, which nothing else would have reached', async () => {
    tables.vault_payments = [
      { id: 'vault-1', external_reference: 'TS-VAULT-STRANDED', created_at: strandedAt(30) },
    ]

    const body = await (await ring()).json()

    expect(settleFromHub).toHaveBeenCalledWith('TS-VAULT-STRANDED')
    expect(body).toMatchObject({ ok: true, checked: 1, vaultChecked: 1, confirmed: 1 })
  })

  it('counts a plan without counting it as a deposit', async () => {
    tables.subscription_payments = [
      { id: 'plan-1', external_reference: 'TS-PLAN', created_at: strandedAt(30) },
    ]

    const body = await (await ring()).json()

    expect(body).toMatchObject({ checked: 1, vaultChecked: 0 })
  })

  it('takes the oldest first across both tables', async () => {
    tables.subscription_payments = [
      { id: 'plan-1', external_reference: 'TS-PLAN-NEWER', created_at: strandedAt(20) },
    ]
    tables.vault_payments = [
      { id: 'vault-1', external_reference: 'TS-VAULT-OLDEST', created_at: strandedAt(90) },
    ]

    await ring()

    /* A payment stranded longer is the one closest to being closed on our own
       clock, so a run that hits its ceiling must not keep skipping it. */
    expect(settleFromHub.mock.calls.map(([reference]) => reference)).toEqual([
      'TS-VAULT-OLDEST',
      'TS-PLAN-NEWER',
    ])
  })

  it('never walks more than one batch, however many are waiting', async () => {
    const many = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${prefix}-${i}`,
        external_reference: `TS-${prefix}-${i}`,
        created_at: strandedAt(30),
      }))
    tables.subscription_payments = many('plan', 40)
    tables.vault_payments = many('vault', 40)

    const body = await (await ring()).json()

    /* The ceiling exists so one sweep cannot run past the function timeout.
       Merging two tables must not quietly double it. */
    expect(body.checked).toBe(40)
    expect(settleFromHub).toHaveBeenCalledTimes(40)
  })

  it('gives up on a deposit the hub has said nothing about for two days', async () => {
    tables.vault_payments = [
      { id: 'vault-1', external_reference: 'TS-VAULT-OLD', created_at: strandedAt(60 * 49) },
    ]
    settleFromHub.mockResolvedValue({ state: 'pending', kind: 'vault' })

    const body = await (await ring()).json()

    expect(applyHubEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.failed', reference: 'TS-VAULT-OLD' }),
    )
    expect(body).toMatchObject({ gaveUp: 1 })
  })

  it('leaves a payment alone when the hub could not be reached', async () => {
    tables.vault_payments = [
      { id: 'vault-1', external_reference: 'TS-VAULT-UNREACHABLE', created_at: strandedAt(60 * 49) },
    ]
    settleFromHub.mockResolvedValue({ state: 'pending', kind: 'vault', unreachable: true })

    const body = await (await ring()).json()

    /* Unreachable is not unpaid. Closing a deposit because a server to server
       call did not land is the one thing this sweep must never do. */
    expect(applyHubEvent).not.toHaveBeenCalled()
    expect(body).toMatchObject({ unreachable: 1, gaveUp: 0 })
  })
})

describe('who may ring it', () => {
  it('refuses a request without the secret, because it moves money', async () => {
    const response = await GET(new Request('https://sideperks.org/api/cron/reconcile-payments'))

    expect(response.status).toBe(401)
    expect(settleFromHub).not.toHaveBeenCalled()
  })
})
