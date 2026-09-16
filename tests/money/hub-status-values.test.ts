import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every status the Tech Store hub is allowed to send, and what each one does.
 *
 * WHY THIS FILE EXISTS. On 16 September 2026 the store shipped an abandonment
 * sweep and told us that `abandoned` had become reachable on
 * `GET /api/internal/hub/payments/{reference}`. It had always been in the
 * contract and had never once been sent, which is the shape of value that
 * quietly stops working: a status nobody has seen is a status nobody has
 * handled, and the way it fails is a buyer on a spinner or, worse, a paid plan
 * left pending because an unfamiliar string fell through to "keep waiting".
 *
 * So this pins the whole set rather than the one new member. A sixth status
 * appearing in `HubStatus` without a branch here is the thing to catch.
 *
 * These are pure: the database and the hub are both mocked, so this file runs
 * on a machine with no credentials.
 */

/* resolve.ts is `server-only`, which throws outside a React Server Component.
   Emptying it is what lets a Node test import the module at all. */
vi.mock('server-only', () => ({}))

const hubPaymentStatus = vi.fn()
const applyHubEvent = vi.fn()
const maybeSingle = vi.fn()

vi.mock('@/lib/payments/hub/client', () => ({ hubPaymentStatus }))
vi.mock('@/lib/payments/hub/fulfil', () => ({ applyHubEvent }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))

const { settleFromHub } = await import('@/lib/payments/hub/resolve')

const REFERENCE = 'TS-A1F552690C01'

/** A payment of ours that is still open, which is the only state that asks the
 *  hub anything. Anything already settled is answered from the row. */
const stillPending = () => maybeSingle.mockResolvedValue({ data: { id: 'p1', status: 'pending' } })

const hubSays = (status: string, over: Record<string, unknown> = {}) =>
  hubPaymentStatus.mockResolvedValue({
    ok: true,
    reference: REFERENCE,
    externalRef: 'p1',
    status,
    amountMinor: 8500,
    currency: 'GHS',
    paidAt: null,
    ...over,
  })

beforeEach(() => {
  vi.clearAllMocks()
  applyHubEvent.mockResolvedValue({ ok: true, state: 'confirmed', alreadyDone: false, paymentId: 'p1' })
})

describe('what each hub status does to a payment', () => {
  it('closes a payment the hub reports as abandoned', async () => {
    stillPending()
    hubSays('abandoned')

    const result = await settleFromHub(REFERENCE)

    /* The same outcome as `failed`, which is what the store asked for: they
       reach `abandoned` by asking Paystack, so it is a definite negative and
       not an unknown. */
    expect(result.state).toBe('failed')
    expect(result.unreachable).toBeFalsy()
    expect(applyHubEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.failed', reference: REFERENCE }),
    )
  })

  it('records which of the two verdicts closed it', async () => {
    stillPending()
    hubSays('abandoned')

    await settleFromHub(REFERENCE)

    /* `failed` and `abandoned` do the same thing and do not mean the same
       thing. One is Paystack declining a card; the other is nobody finishing.
       An admin reading the row afterwards should be able to tell. */
    expect(applyHubEvent.mock.calls[0]?.[0].payload).toMatchObject({ hub_status: 'abandoned' })

    vi.clearAllMocks()
    applyHubEvent.mockResolvedValue({ ok: true, state: 'failed', alreadyDone: false, paymentId: 'p1' })
    stillPending()
    hubSays('failed')
    await settleFromHub(REFERENCE)
    expect(applyHubEvent.mock.calls[0]?.[0].payload).toMatchObject({ hub_status: 'failed' })
  })

  it('never treats abandoned as a reason to keep waiting', async () => {
    stillPending()
    hubSays('abandoned')

    const result = await settleFromHub(REFERENCE)

    /* The failure that matters. If an unhandled status fell through to the
       `initialized` branch at the bottom, this would be `pending` and the
       buyer would watch a spinner until the sweep closed the row two days
       later. */
    expect(result.state).not.toBe('pending')
  })

  it('grants the plan on success and nothing else', async () => {
    stillPending()
    hubSays('success', { paidAt: '2026-09-16T21:00:00Z' })

    const result = await settleFromHub(REFERENCE)

    expect(result.state).toBe('confirmed')
    expect(applyHubEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.success', amountMinor: 8500, currency: 'GHS' }),
    )
  })

  it('revokes on a reversal', async () => {
    stillPending()
    hubSays('reversed')
    applyHubEvent.mockResolvedValue({ ok: true, state: 'reversed', alreadyDone: false, paymentId: 'p1' })

    const result = await settleFromHub(REFERENCE)

    expect(result.state).toBe('reversed')
    expect(applyHubEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'payment.reversed' }))
  })

  it('leaves an initialized payment alone', async () => {
    stillPending()
    hubSays('initialized')

    const result = await settleFromHub(REFERENCE)

    expect(result.state).toBe('pending')
    expect(applyHubEvent).not.toHaveBeenCalled()
  })

  it('does not fail a payment because the hub could not be reached', async () => {
    stillPending()
    hubPaymentStatus.mockResolvedValue({
      ok: false,
      retryable: true,
      notFound: false,
      message: 'The payment hub did not answer in time.',
    })

    const result = await settleFromHub(REFERENCE)

    /* Silence is not a negative. A real payment marked failed over a dropped
       connection is the one mistake this whole path exists to avoid. */
    expect(result.state).toBe('pending')
    expect(result.unreachable).toBe(true)
    expect(applyHubEvent).not.toHaveBeenCalled()
  })
})

describe('the set of statuses itself', () => {
  it('leaves exactly one status open, and it is initialized', async () => {
    const CONTRACT: string[] = ['initialized', 'success', 'failed', 'abandoned', 'reversed']

    const open: string[] = []
    for (const status of CONTRACT) {
      vi.clearAllMocks()
      applyHubEvent.mockResolvedValue({ ok: true, state: 'failed', alreadyDone: false, paymentId: 'p1' })
      stillPending()
      hubSays(status)

      const result = await settleFromHub(REFERENCE)
      if (result.state === 'pending') open.push(status)
    }

    /* ⚠️ THE TRAP THIS CATCHES. A status with no branch of its own falls
       through to the bottom of `settleFromHub`, which answers `pending`, the
       same word an unfinished payment gets. It does not throw and it does not
       read as wrong anywhere: the buyer simply waits for something that has
       already happened. So the assertion is not "nothing threw", it is that
       only `initialized` is still open when the hub has spoken. */
    expect(open).toEqual(['initialized'])
  })
})
