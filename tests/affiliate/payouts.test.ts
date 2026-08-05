import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  createUser,
  expectRejection,
  givePayoutDetails,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * Withdrawing commission (M9).
 *
 * The property worth more than the rest: REQUESTING TAKES THE MONEY OUT OF THE
 * AVAILABLE BALANCE IMMEDIATELY. Without that, three requests against one
 * balance are reachable by tapping twice before an operator looks at the
 * queue, and only one of them is real money.
 *
 * The second is that a rejection puts it back by REVERSING THE HOLD rather
 * than adding a credit. Migration 116 is the scar from doing both: the money
 * came off twice.
 */

const superAdmin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

/** An affiliate with a real commission balance and somewhere to send it. */
const earner = async (tx: Tx, by: string, name: string, minor = 20_000) => {
  const user = await createUser(tx, { name })
  seq += 1

  await tx.query(
    `insert into public.affiliate_accounts (user_id, affiliate_code, status, activated_at)
     values ($1, public.generate_affiliate_code(), 'active', now())`,
    [user.id],
  )
  const { rows: acc } = await tx.query<{ id: string }>(
    `select id from public.affiliate_accounts where user_id = $1`,
    [user.id],
  )

  await tx.query(
    `insert into public.commission_ledger
       (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
     values ($1, 'adjustment', $2, 'cleared', 'test balance', $3)`,
    [acc[0]!.id, minor, `payout-test-${Date.now()}-${seq}`],
  )

  await givePayoutDetails(tx, user.id)
  return { user, affiliateId: acc[0]!.id }
}

const open = async (tx: Tx) => setConfig(tx, 'affiliate_payouts_enabled', 'true')

const balance = async (tx: Tx, affiliateId: string) => {
  const { rows } = await tx.query<{ b: string }>(
    `select public.affiliate_balance_minor($1)::text as b`,
    [affiliateId],
  )
  return Number(rows[0]!.b)
}

const request = async (tx: Tx, userId: string, minor: number) => {
  const { rows } = await tx.query<{
    id: string
    amount_minor: string
    fee_minor: string
    net_minor: string
    fee_percent: string
  }>(
    `select id, amount_minor::text, fee_minor::text, net_minor::text, fee_percent::text
       from public.request_commission_payout($1, $2)`,
    [userId, minor],
  )
  return rows[0]!
}

describe.skipIf(!HAS_DB)('the licence gate', () => {
  it('refuses everything while withdrawals are closed', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const { user } = await earner(tx, by, 'Too Early')

      /* H45: off by default and independent of the points switch, so one
         business can be opened without committing the other. */
      const message = await expectRejection(tx, () => request(tx, user.id, 10_000))
      expect(message).toMatch(/not open yet/i)
    })
  })
})

describe.skipIf(!HAS_DB)('asking for the money', () => {
  it('charges the SAME fee as points withdrawals, frozen onto the request', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      await setConfig(tx, 'redemption_fee_percent', '10')
      const { user } = await earner(tx, by, 'Fee Payer', 20_000)

      const payout = await request(tx, user.id, 10_000)
      expect([Number(payout.fee_percent), Number(payout.fee_minor), Number(payout.net_minor)])
        .toEqual([10, 1_000, 9_000])

      /* Frozen: the operator changing the fee tomorrow must not re-price a
         request made today, and the queue shows what will actually land. */
      await setConfig(tx, 'redemption_fee_percent', '25')
      const { rows } = await tx.query<{ fee_minor: string }>(
        `select fee_minor::text from public.commission_payouts where id = $1`,
        [payout.id],
      )
      expect(Number(rows[0]!.fee_minor)).toBe(1_000)
    })
  })

  it('takes the money out of the balance immediately, not on approval', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user, affiliateId } = await earner(tx, by, 'Immediate Hold', 20_000)

      expect(await balance(tx, affiliateId)).toBe(20_000)
      await request(tx, user.id, 12_000)

      /* THE PROPERTY THIS WHOLE DESIGN TURNS ON. Deferring the hold to
         approval makes "request twice quickly" a way to withdraw a balance
         you only have once. */
      expect(await balance(tx, affiliateId)).toBe(8_000)
    })
  })

  it('refuses a second request while one is open', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user } = await earner(tx, by, 'Double Asker', 20_000)

      await request(tx, user.id, 6_000)
      const message = await expectRejection(tx, () => request(tx, user.id, 6_000))
      expect(message).toMatch(/commission_payouts_one_open_idx|already/i)
    })
  })

  it('refuses more than the balance', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user } = await earner(tx, by, 'Optimist', 8_000)

      const message = await expectRejection(tx, () => request(tx, user.id, 9_000))
      expect(message).toMatch(/you only have/i)
    })
  })

  it('refuses below the minimum', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      await setConfig(tx, 'commission_payout_minimum_minor', '5000')
      const { user } = await earner(tx, by, 'Small Asker', 20_000)

      const message = await expectRejection(tx, () => request(tx, user.id, 4_000))
      expect(message).toMatch(/least you can withdraw/i)
    })
  })

  it('refuses outright when the balance is negative', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user, affiliateId } = await earner(tx, by, 'In The Red', 5_000)

      seq += 1
      await tx.query(
        `insert into public.commission_ledger
           (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
         values ($1, 'reversal', -8000, 'cleared', 'refund', $2)`,
        [affiliateId, `neg-${Date.now()}-${seq}`],
      )
      expect(await balance(tx, affiliateId)).toBeLessThan(0)

      /* C21: the Owner chose to block rather than write the loss off, so this
         refuses rather than quietly offering a smaller amount. */
      const message = await expectRejection(tx, () => request(tx, user.id, 1_000))
      expect(message).toMatch(/nothing to withdraw/i)
    })
  })

  it('refuses a suspended affiliate', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user, affiliateId } = await earner(tx, by, 'Suspended Asker', 20_000)
      await tx.query(`update public.affiliate_accounts set status = 'suspended' where id = $1`, [
        affiliateId,
      ])

      const message = await expectRejection(tx, () => request(tx, user.id, 6_000))
      expect(message).toMatch(/suspended/i)
    })
  })

  it('refuses while payout details are inside the cool-off', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user } = await earner(tx, by, 'Just Changed', 20_000)

      await tx.query(
        `update public.user_payout_details set last_changed_at = now() where user_id = $1`,
        [user.id],
      )

      /* The same anti-takeover delay Phase 1 applies to points: take over an
         account, change the destination, withdraw before anybody notices. */
      const message = await expectRejection(tx, () => request(tx, user.id, 6_000))
      expect(message).toMatch(/changed recently/i)
    })
  })

  it('freezes the destination, so changing it later cannot redirect the money', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user } = await earner(tx, by, 'Redirecting', 20_000)

      const payout = await request(tx, user.id, 6_000)

      await tx.query(
        `update public.user_payout_details set msisdn = '0200000999' where user_id = $1`,
        [user.id],
      )

      const { rows } = await tx.query<{ snapshot_msisdn: string }>(
        `select snapshot_msisdn from public.commission_payouts where id = $1`,
        [payout.id],
      )
      expect(rows[0]!.snapshot_msisdn).toBe('0244000111')
    })
  })
})

describe.skipIf(!HAS_DB)('deciding', () => {
  it('approving leaves the money held, paying settles it', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user, affiliateId } = await earner(tx, by, 'Approved Payee', 20_000)
      const payout = await request(tx, user.id, 12_000)

      await tx.query(`select public.decide_commission_payout($1, $2, 'approve', 'looks fine')`, [
        by,
        payout.id,
      ])
      expect(await balance(tx, affiliateId)).toBe(8_000)

      await tx.query(`select public.mark_commission_payout_paid($1, $2, 'MOMO-123')`, [
        by,
        payout.id,
      ])
      // Still 8,000: paying does not take it off twice, it settles what was held.
      expect(await balance(tx, affiliateId)).toBe(8_000)

      const { rows } = await tx.query<{ status: string; external_reference: string }>(
        `select status::text, external_reference from public.commission_payouts where id = $1`,
        [payout.id],
      )
      expect([rows[0]!.status, rows[0]!.external_reference]).toEqual(['paid', 'MOMO-123'])
    })
  })

  it('rejecting gives the money back exactly once', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user, affiliateId } = await earner(tx, by, 'Rejected Payee', 20_000)
      const payout = await request(tx, user.id, 12_000)
      expect(await balance(tx, affiliateId)).toBe(8_000)

      await tx.query(`select public.decide_commission_payout($1, $2, 'reject', 'wrong number')`, [
        by,
        payout.id,
      ])

      /* Back to 20,000 — not 32,000. The hold is REVERSED rather than
         compensated with a credit; doing both is what made a refund take the
         money off twice in migration 116. */
      expect(await balance(tx, affiliateId)).toBe(20_000)

      const { rows } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.commission_ledger
          where affiliate_id = $1 and entry_type = 'payout'`,
        [affiliateId],
      )
      expect(Number(rows[0]!.n)).toBe(1)
    })
  })

  it('lets them ask again after a rejection', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user } = await earner(tx, by, 'Second Attempt', 20_000)
      const first = await request(tx, user.id, 12_000)
      await tx.query(`select public.decide_commission_payout($1, $2, 'reject', 'wrong number')`, [
        by,
        first.id,
      ])

      // The one-open-request index only counts requested and approved.
      const second = await request(tx, user.id, 12_000)
      expect(second.id).toBeTruthy()
    })
  })

  it('refuses a rejection with no reason', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user } = await earner(tx, by, 'Reasonless Rejection', 20_000)
      const payout = await request(tx, user.id, 6_000)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.decide_commission_payout($1, $2, 'reject', '  ')`, [by, payout.id]),
      )
      expect(message).toMatch(/needs a reason/i)
    })
  })

  it('refuses to pay something that was never approved', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user } = await earner(tx, by, 'Straight To Paid', 20_000)
      const payout = await request(tx, user.id, 6_000)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.mark_commission_payout_paid($1, $2, 'REF')`, [by, payout.id]),
      )
      expect(message).toMatch(/only an approved withdrawal/i)
    })
  })

  it('is idempotent on marking paid twice', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user, affiliateId } = await earner(tx, by, 'Paid Twice', 20_000)
      const payout = await request(tx, user.id, 6_000)
      await tx.query(`select public.decide_commission_payout($1, $2, 'approve', null)`, [
        by,
        payout.id,
      ])

      await tx.query(`select public.mark_commission_payout_paid($1, $2, 'REF-1')`, [by, payout.id])
      await tx.query(`select public.mark_commission_payout_paid($1, $2, 'REF-2')`, [by, payout.id])

      expect(await balance(tx, affiliateId)).toBe(14_000)
      const { rows } = await tx.query<{ external_reference: string }>(
        `select external_reference from public.commission_payouts where id = $1`,
        [payout.id],
      )
      // The first reference stands; a second call is a no-op, not a rewrite.
      expect(rows[0]!.external_reference).toBe('REF-1')
    })
  })
})

describe.skipIf(!HAS_DB)('the queue', () => {
  it('masks the destination', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      const { user } = await earner(tx, by, 'Masked Payee', 20_000)
      await request(tx, user.id, 6_000)

      const { rows } = await tx.query<{ destination: string; net_minor: string }>(
        `select destination, net_minor::text from public.admin_list_commission_payouts('requested')`,
      )
      const mine = rows.find((r) => r.destination.includes('MTN') || r.destination.length > 0)!

      /* An operator deciding a payout needs to RECOGNISE a destination, not
         read it out — the same rule Phase 1's payout queue follows. */
      expect(mine.destination).not.toContain('0244000111')
      expect(mine.destination).toMatch(/\*|•|x/i)
    })
  })

  it('shows the NET, which is what will actually land', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      await open(tx)
      await setConfig(tx, 'redemption_fee_percent', '10')
      const { user, affiliateId } = await earner(tx, by, 'Net Payee', 20_000)
      await request(tx, user.id, 10_000)

      const { rows } = await tx.query<{ amount_minor: string; net_minor: string }>(
        `select amount_minor::text, net_minor::text
           from public.admin_list_commission_payouts('requested')
          where affiliate_id = $1`,
        [affiliateId],
      )
      expect([Number(rows[0]!.amount_minor), Number(rows[0]!.net_minor)]).toEqual([10_000, 9_000])
    })
  })
})
