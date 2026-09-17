import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What actually reaches `confirm_subscription_payment`, and what never does.
 *
 * The readings themselves are pinned in `hub-amount-guard.test.ts`, which is
 * pure. This file is about the WIRING: a guard that returns the right verdict
 * into a branch nobody checks is not a guard. The regression it was written
 * for granted plans for months without the RPC ever being told a figure was
 * wrong, because the figure was compared against itself.
 *
 * So every assertion here is about whether the RPC was called. A plan is
 * granted when, and only when, one of them says it was.
 *
 * The database is a mock: the rules being tested are this app's, not
 * Postgres's, and `late-payment-confirmation.test.ts` covers the SQL half
 * against a real connection.
 */

vi.mock('server-only', () => ({}))

const rpc = vi.fn()
const paymentRow = vi.fn()
const configRow = vi.fn()

/* One client, two tables, and which one you get depends on the name. Written
   out rather than hidden behind a helper because the `app_config` read is the
   thing most likely to be wired to the wrong table by a later edit. */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: table === 'app_config' ? configRow : paymentRow,
        }),
      }),
    }),
    rpc,
  }),
}))

const { applyHubEvent } = await import('@/lib/payments/hub/fulfil')

const REFERENCE = 'TS-9F4C2A7B61E8'

const pendingPayment = (over: Record<string, unknown> = {}) =>
  paymentRow.mockResolvedValue({
    data: { id: 'pay-1', status: 'pending', amount_minor: 52000, currency_code: 'GHS', ...over },
    error: null,
  })

const acceptTestPayments = (on: boolean) =>
  configRow.mockResolvedValue({ data: { value: String(on) }, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({ error: null })
  pendingPayment()
  acceptTestPayments(false)
})

describe('a success carrying the right money', () => {
  it('grants the plan', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 52000,
      currency: 'GHS',
      payload: { amount_minor: 52000 },
    })

    expect(outcome).toMatchObject({ ok: true, state: 'confirmed', alreadyDone: false })
    expect(rpc).toHaveBeenCalledWith('confirm_subscription_payment', expect.anything())
  })
})

describe('a success carrying no money at all', () => {
  /*
    THE REGRESSION. `Number(input.amountMinor ?? expected)` made an absent
    amount equal to the expected one, so this call used to grant a plan with
    nothing compared. It is the shape of fault the Tech Store found in their
    own guard and reported on 17 September 2026, reached here by a different
    road: theirs compared two absences, ours compared an expectation with
    itself.
  */
  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['zero', 0],
    ['an empty string', ''],
  ])('refuses and grants nothing when the hub states %s', async (_label, amountMinor) => {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: amountMinor as number | null,
      currency: 'GHS',
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'mismatch', paymentId: 'pay-1' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses when the hub states no currency', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 52000,
      currency: null,
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'mismatch' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a figure that disagrees, as it always did', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 100,
      currency: 'GHS',
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'mismatch' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('a success on a Paystack account in test mode', () => {
  const testMoney = {
    event: 'payment.success' as const,
    reference: REFERENCE,
    amountMinor: 52000,
    currency: 'GHS',
    payload: { event: 'payment.success', amount_minor: 52000, domain: 'test' },
  }

  it('grants nothing while the switch is off', async () => {
    const outcome = await applyHubEvent(testMoney)

    expect(outcome).toMatchObject({ ok: false, reason: 'test_mode', paymentId: 'pay-1' })
    expect(outcome).toMatchObject({ detail: expect.stringContaining('TEST mode') })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('grants the plan once an admin turns the switch on, for a rehearsal', async () => {
    acceptTestPayments(true)

    const outcome = await applyHubEvent(testMoney)

    expect(outcome).toMatchObject({ ok: true, state: 'confirmed' })
    expect(rpc).toHaveBeenCalledWith('confirm_subscription_payment', expect.anything())
  })

  /* ⚠️ A MISSING CONFIG ROW MUST READ AS OFF. `app_config`'s select policy is
     `is_public or is_admin()` and this key is private, so a read through the
     wrong client comes back empty. Empty has to mean no. */
  it('treats an unreadable switch as off', async () => {
    configRow.mockResolvedValue({ data: null, error: null })

    expect(await applyHubEvent(testMoney)).toMatchObject({ reason: 'test_mode' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not ask about the switch at all when the money is live', async () => {
    await applyHubEvent({ ...testMoney, payload: { ...testMoney.payload, domain: 'live' } })

    expect(configRow).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('confirm_subscription_payment', expect.anything())
  })

  /* Today's real traffic. The hub does not send `domain`, so nothing may be
     refused for lacking it, or every genuine payment stops. */
  it('grants a payment the hub does not classify, which is all of them today', async () => {
    await applyHubEvent({
      event: 'payment.success',
      reference: REFERENCE,
      amountMinor: 52000,
      currency: 'GHS',
      payload: { event: 'payment.success', amount_minor: 52000 },
    })

    expect(rpc).toHaveBeenCalledWith('confirm_subscription_payment', expect.anything())
  })
})

describe('what the money checks do NOT touch', () => {
  /* A failure and a reversal carry the original amount for context. Refusing
     to act on a reversal because a figure disagreed would leave a refunded
     payment holding a live plan, which is the wrong way to fail. */
  it('reverses a refunded payment even on test money at a wrong amount', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.reversed',
      reference: REFERENCE,
      amountMinor: 1,
      currency: 'USD',
      payload: { domain: 'test' },
    })

    expect(outcome).toMatchObject({ ok: true, state: 'reversed' })
    expect(rpc).toHaveBeenCalledWith('reverse_subscription_payment', expect.anything())
  })

  it('fails a payment without weighing the amount', async () => {
    const outcome = await applyHubEvent({
      event: 'payment.failed',
      reference: REFERENCE,
      amountMinor: null,
      currency: null,
    })

    expect(outcome).toMatchObject({ ok: true, state: 'failed' })
    expect(rpc).toHaveBeenCalledWith('fail_subscription_payment', expect.anything())
  })
})

describe('a reference this app has never had', () => {
  it('is not found, and is not an error', async () => {
    paymentRow.mockResolvedValue({ data: null, error: null })

    expect(
      await applyHubEvent({ event: 'payment.success', reference: 'TS-NOTOURS', amountMinor: 52000, currency: 'GHS' }),
    ).toEqual({ ok: false, reason: 'not_found' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('a payment already confirmed', () => {
  it('says so without granting twice', async () => {
    pendingPayment({ status: 'confirmed' })

    expect(
      await applyHubEvent({
        event: 'payment.success',
        reference: REFERENCE,
        amountMinor: 52000,
        currency: 'GHS',
      }),
    ).toMatchObject({ ok: true, alreadyDone: true })
    expect(rpc).not.toHaveBeenCalled()
  })
})
