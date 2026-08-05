import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Phase 2, step 6: the commission money path.
 *
 * This is the file that costs real money when it is wrong, so the assertions
 * are arithmetic rather than shape wherever they can be. Four properties get
 * the most attention:
 *
 *  - the two levels together can NEVER exceed the sale, whatever the rates
 *  - a retried webhook pays once
 *  - a refund unwinds BOTH levels, by adding negative rows rather than editing
 *  - a reversal after a payout is allowed to drive a balance negative, because
 *    C21 chose "block future payouts" over writing the loss off
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

const makeProduct = async (
  tx: Tx,
  by: string,
  o: { price?: number; purpose?: string; l1?: number; l2?: number; hold?: number } = {},
) => {
  const { price = 20_000, purpose = 'vendor_product', l1 = 30, l2 = 10, hold = 0 } = o
  seq += 1
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', $1::public.product_purpose, 'Thing', $2, $3, 'published', $4) returning id`,
    [purpose, `comm-${Date.now()}-${seq}`, price, by],
  )
  await tx.query(
    `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value, hold_days)
     values ($1, $2, $3, $4)`,
    [rows[0]!.id, l1, l2, hold],
  )
  return rows[0]!.id
}

const makeTraining = async (tx: Tx, by: string, level = 'professional') => {
  const productId = await makeProduct(tx, by, { purpose: 'training_program', price: 40_000 })
  await tx.query(
    `insert into public.training_programs
       (product_id, level, commission_depth, activation_threshold_percent, quiz_required)
     values ($1, $2::public.affiliate_tier, $3, 0, false)`,
    [productId, level, level === 'professional' ? 2 : 1],
  )
  return productId
}

const buy = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.start_product_order($1, $2, 'paystack')`,
    [userId, productId],
  )
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2, null)`, [
    rows[0]!.id,
    `COMM-${Date.now()}-${seq}`,
  ])
  return rows[0]!.id
}

const accountOf = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ id: string; affiliate_code: string }>(
    `select id, affiliate_code from public.affiliate_accounts where user_id = $1`,
    [userId],
  )
  return rows[0]!
}

const makeAffiliate = async (tx: Tx, by: string, name: string, level = 'professional') => {
  const user = await createUser(tx, { name })
  await buy(tx, user.id, await makeTraining(tx, by, level))
  return { user, account: await accountOf(tx, user.id) }
}

const click = async (tx: Tx, code: string, productId: string, userId: string) => {
  await tx.query(`select public.record_affiliate_click($1, $2, null, null, $3)`, [
    code,
    productId,
    userId,
  ])
}

const balance = async (tx: Tx, affiliateId: string) => {
  const { rows } = await tx.query<{ b: string }>(
    `select public.affiliate_balance_minor($1)::text as b`,
    [affiliateId],
  )
  return Number(rows[0]!.b)
}

const entries = async (tx: Tx, conversionOrder: string) => {
  const { rows } = await tx.query<{
    level: number
    entry_type: string
    amount_minor: string
    status: string
  }>(
    `select l.level, l.entry_type::text, l.amount_minor::text, l.status::text
       from public.commission_ledger l
       join public.conversions c on c.id = l.conversion_id
      where c.order_id = $1
      order by l.level, l.entry_type`,
    [conversionOrder],
  )
  return rows
}

describe.skipIf(!HAS_DB)('what a sale pays', () => {
  it('pays level one a percentage of what was charged', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Seller')
      const buyer = await createUser(tx, { name: 'Customer' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30, l2: 10 })

      await click(tx, seller.account.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)

      // 30% of GHS 200.00 = GHS 60.00
      expect(await balance(tx, seller.account.id)).toBe(6_000)
      const rows = await entries(tx, order)
      expect(rows.map((r) => [r.level, r.entry_type, Number(r.amount_minor), r.status])).toEqual([
        [1, 'credit', 6_000, 'cleared'],
      ])
    })
  })

  it('pays BOTH levels a percentage of the whole sale', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const upline = await makeAffiliate(tx, by, 'Upline', 'professional')
      const training = await makeTraining(tx, by, 'professional')
      const seller = await createUser(tx, { name: 'Recruited Seller' })

      await click(tx, upline.account.affiliate_code, training, seller.id)
      await buy(tx, seller.id, training)
      const sellerAccount = await accountOf(tx, seller.id)

      /* MEASURED AS A DELTA, because the upline has already earned level-one
         commission on the TRAINING they sold — training pays commission at
         both levels (C16), so their balance is not zero to begin with. */
      const uplineBefore = await balance(tx, upline.account.id)

      const buyer = await createUser(tx, { name: 'End Customer' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30, l2: 10 })
      await click(tx, sellerAccount.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      /* Operator decision, 2026-08-06, uniform across every product: both
         levels are a percentage of the TOTAL. L1 = 30% of 20,000 = 6,000 and
         L2 = 10% of 20,000 = 2,000 — not 10% of what was left.

         This reverses the remainder rule approved earlier the same day. The
         "cannot exceed the sale" guarantee now rests on the constraint that
         refuses rate pairs above 100%, rather than on the arithmetic. */
      expect(await balance(tx, sellerAccount.id)).toBe(6_000)
      expect((await balance(tx, upline.account.id)) - uplineBefore).toBe(2_000)
    })
  })

  it('never pays out more than the sale, even at the maximum rates', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const upline = await makeAffiliate(tx, by, 'Greedy Upline', 'professional')
      const training = await makeTraining(tx, by, 'professional')
      const seller = await createUser(tx, { name: 'Greedy Seller' })
      await click(tx, upline.account.affiliate_code, training, seller.id)
      await buy(tx, seller.id, training)
      const sellerAccount = await accountOf(tx, seller.id)

      const buyer = await createUser(tx, { name: 'Odd Amount' })
      // Deliberately awkward: 60/40 on a number that does not divide evenly.
      const product = await makeProduct(tx, by, { price: 12_345, l1: 60, l2: 40 })
      await click(tx, sellerAccount.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)

      const paid = (await entries(tx, order))
        .filter((r) => r.entry_type === 'credit')
        .reduce((n, r) => n + Number(r.amount_minor), 0)

      /* 60% + 40% of an amount that does not divide evenly. Both levels round
         independently now, so without the clamp on level two this pays out one
         pesewa MORE than the sale brought in — and reconciliation would report
         a ledger that does not balance, which is a bad way to find out about a
         rounding rule. */
      expect(paid).toBeLessThanOrEqual(12_345)
    })
  })

  it('pays nothing to an upline who is only a Beginner', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const upline = await makeAffiliate(tx, by, 'Beginner Upline', 'beginner')
      const training = await makeTraining(tx, by, 'professional')
      const seller = await createUser(tx, { name: 'Seller Two' })
      await click(tx, upline.account.affiliate_code, training, seller.id)
      await buy(tx, seller.id, training)
      const sellerAccount = await accountOf(tx, seller.id)

      // Again a delta: a Beginner still earns level one on the training they
      // sold; what they must not earn is the override.
      const uplineBefore = await balance(tx, upline.account.id)

      const buyer = await createUser(tx, { name: 'Buyer Two' })
      const product = await makeProduct(tx, by)
      await click(tx, sellerAccount.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      expect((await balance(tx, upline.account.id)) - uplineBefore).toBe(0)
    })
  })

  it('pays once however many times the webhook is retried', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Retry Seller')
      const buyer = await createUser(tx, { name: 'Retry Customer' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      await click(tx, seller.account.affiliate_code, product, buyer.id)

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_product_order($1, $2, 'paystack')`,
        [buyer.id, product],
      )
      const ref = `COMM-RETRY-${Date.now()}`
      await tx.query(`select public.confirm_product_order($1, $2, null)`, [rows[0]!.id, ref])
      await tx.query(`select public.confirm_product_order($1, $2, null)`, [rows[0]!.id, ref])
      // And directly, in case something ever calls it outside confirm.
      const { rows: conv } = await tx.query<{ id: string }>(
        `select id from public.conversions where order_id = $1`,
        [rows[0]!.id],
      )
      await tx.query(`select public.pay_conversion_commissions($1)`, [conv[0]!.id])

      expect(await balance(tx, seller.account.id)).toBe(6_000)
      expect((await entries(tx, rows[0]!.id)).length).toBe(1)
    })
  })
})

describe.skipIf(!HAS_DB)('the hold period', () => {
  it('clears immediately while the hold is zero', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'No Hold')
      const buyer = await createUser(tx, { name: 'Instant Buyer' })
      const product = await makeProduct(tx, by, { hold: 0 })
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      expect(await balance(tx, seller.account.id)).toBe(6_000)
    })
  })

  it('holds the money but still shows it, when a hold is set', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Held')
      const buyer = await createUser(tx, { name: 'Held Buyer' })
      const product = await makeProduct(tx, by, { hold: 14 })
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      /* The state machine is why C19's "no hold" is a setting rather than a
         removal — turning it on needs no new code. The affiliate sees the
         commission immediately; it simply cannot leave yet. */
      expect(await balance(tx, seller.account.id)).toBe(0)
      const { rows } = await tx.query<{ p: string }>(
        `select public.affiliate_pending_minor($1)::text as p`,
        [seller.account.id],
      )
      expect(Number(rows[0]!.p)).toBe(6_000)
    })
  })

  it('clears what is due when the hold has passed', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Clearing')
      const buyer = await createUser(tx, { name: 'Clearing Buyer' })
      const product = await makeProduct(tx, by, { hold: 14 })
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      await tx.query(
        `update public.commission_ledger set clears_at = now() - interval '1 day'
          where status = 'pending' and affiliate_id = $1`,
        [seller.account.id],
      )
      await tx.query(`select public.clear_due_commissions()`)

      expect(await balance(tx, seller.account.id)).toBe(6_000)
    })
  })
})

describe.skipIf(!HAS_DB)('a refund unwinds the commission', () => {
  it('reverses both levels with negative rows, leaving the credits intact', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const upline = await makeAffiliate(tx, by, 'Refund Upline', 'professional')
      const training = await makeTraining(tx, by, 'professional')
      const seller = await createUser(tx, { name: 'Refund Seller' })
      await click(tx, upline.account.affiliate_code, training, seller.id)
      await buy(tx, seller.id, training)
      const sellerAccount = await accountOf(tx, seller.id)

      const uplineBefore = await balance(tx, upline.account.id)

      const buyer = await createUser(tx, { name: 'Refund Buyer' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30, l2: 10 })
      await click(tx, sellerAccount.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)

      expect(await balance(tx, sellerAccount.id)).toBe(6_000)
      expect((await balance(tx, upline.account.id)) - uplineBefore).toBe(2_000)

      await tx.query(`select public.refund_product_order($1, $2, 'faulty content')`, [order, by])

      // Both back exactly where they started — not further.
      expect(await balance(tx, sellerAccount.id)).toBe(0)
      expect(await balance(tx, upline.account.id)).toBe(uplineBefore)

      /* …and the history reads as what happened. The credits are still there
         at their original amounts, with reversals beside them. */
      const rows = await entries(tx, order)
      expect(rows.filter((r) => r.entry_type === 'credit').length).toBe(2)
      expect(rows.filter((r) => r.entry_type === 'reversal').length).toBe(2)
      /* The credits keep their original status. In a ledger what happened is
         the ROWS — moving the credit out of the balance set while a reversal
         row also subtracted is precisely the double-count of migration 116. */
      expect(rows.filter((r) => r.entry_type === 'credit').every((r) => r.status === 'cleared')).toBe(true)
    })
  })

  it('leaves a negative balance when the money was already paid out', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Paid Out Then Refunded')
      const buyer = await createUser(tx, { name: 'Late Refunder' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)

      // The affiliate withdraws the lot.
      await tx.query(
        `insert into public.commission_ledger
           (affiliate_id, entry_type, amount_minor, status, idempotency_key)
         values ($1, 'payout', -6000, 'paid', $2)`,
        [seller.account.id, `payout-test-${Date.now()}`],
      )
      expect(await balance(tx, seller.account.id)).toBe(0)

      await tx.query(`select public.refund_product_order($1, $2, 'chargeback')`, [order, by])

      /* C21: the Owner chose "block future payouts until the balance is clear"
         over writing the loss off. So a negative balance is a real state the
         payout path must handle rather than assume away.

         EXACTLY −6,000, not −12,000. Migration 116 exists because the first
         version both inserted a reversal row AND pushed the credit out of the
         balance sum, so a refund took the money back twice. */
      expect(await balance(tx, seller.account.id)).toBe(-6_000)
    })
  })

  it('refuses a reversal with no reason', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Reasonless')
      const buyer = await createUser(tx, { name: 'Reasonless Buyer' })
      const product = await makeProduct(tx, by)
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)
      const { rows } = await tx.query<{ id: string }>(
        `select id from public.conversions where order_id = $1`,
        [order],
      )

      const message = await expectRejection(tx, () =>
        tx.query(`select public.reverse_conversion_commissions($1, '   ')`, [rows[0]!.id]),
      )
      expect(message).toMatch(/needs a reason/i)
    })
  })
})

describe.skipIf(!HAS_DB)('the ledger cannot be rewritten', () => {
  it('refuses an edit to the amount', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Immutable')
      const buyer = await createUser(tx, { name: 'Immutable Buyer' })
      const product = await makeProduct(tx, by)
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      const message = await expectRejection(tx, () =>
        tx.query(`update public.commission_ledger set amount_minor = 999999 where affiliate_id = $1`, [
          seller.account.id,
        ]),
      )
      expect(message).toMatch(/cannot be rewritten/i)
    })
  })

  it('refuses a delete', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Undeletable')
      const buyer = await createUser(tx, { name: 'Undeletable Buyer' })
      const product = await makeProduct(tx, by)
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      const message = await expectRejection(tx, () =>
        tx.query(`delete from public.commission_ledger where affiliate_id = $1`, [seller.account.id]),
      )
      expect(message).toMatch(/cannot be deleted/i)
    })
  })
})

describe.skipIf(!HAS_DB)('reconciliation', () => {
  it('is quiet on a healthy ledger', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Healthy')
      const buyer = await createUser(tx, { name: 'Healthy Buyer' })
      const product = await makeProduct(tx, by)
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)
      await tx.query(`select public.refund_product_order($1, $2, 'tidy refund')`, [order, by])

      const { rows } = await tx.query(`select * from public.reconcile_commission_ledger()`)
      expect(rows.length).toBe(0)
    })
  })

  it('notices a credit still standing against a reversed conversion', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Broken')
      const buyer = await createUser(tx, { name: 'Broken Buyer' })
      const product = await makeProduct(tx, by)
      await click(tx, seller.account.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)

      /* Corrupt it the way a half-finished reversal would: the conversion is
         marked reversed but the credit was never unwound. Exactly the shape a
         crash between two statements leaves behind. */
      await tx.query(
        `update public.conversions set status = 'reversed' where order_id = $1`,
        [order],
      )

      const { rows } = await tx.query<{ problem: string }>(
        `select problem from public.reconcile_commission_ledger()`,
      )
      expect(rows.some((r) => /reversed conversion/i.test(r.problem))).toBe(true)
    })
  })
})
