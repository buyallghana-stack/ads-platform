import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, withRollback } from '../support/db'

/**
 * Phase 2, step 7: the reports the programme is watched by.
 *
 * Two of these exist because training sales pay commission (C16). They are
 * what turns "is this programme driven by selling or by recruiting?" from a
 * matter of opinion into a number, so the tests care about one thing above
 * all: that the number is NET OF REVERSALS. A report counting money that was
 * later taken back credits people for refunded sales, and Phase 1 already
 * learned that on its points leaderboard.
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
  o: { price?: number; purpose?: string; l1?: number; l2?: number } = {},
) => {
  const { price = 20_000, purpose = 'vendor_product', l1 = 30, l2 = 10 } = o
  seq += 1
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', $1::public.product_purpose, 'Thing', $2, $3, 'published', $4) returning id`,
    [purpose, `rep-${Date.now()}-${seq}`, price, by],
  )
  await tx.query(
    `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value)
     values ($1, $2, $3)`,
    [rows[0]!.id, l1, l2],
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
    `REP-${Date.now()}-${seq}`,
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

const makeAffiliate = async (tx: Tx, by: string, name: string) => {
  const user = await createUser(tx, { name })
  await buy(tx, user.id, await makeTraining(tx, by))
  return { user, account: await accountOf(tx, user.id) }
}

const click = async (tx: Tx, code: string, productId: string, userId: string) => {
  await tx.query(`select public.record_affiliate_click($1, $2, null, null, $3)`, [
    code,
    productId,
    userId,
  ])
}

/** Scoped to one affiliate, because the shared project has other data. */
const reportFor = async (tx: Tx, affiliateId: string) => {
  const { rows } = await tx.query<{
    product_commission_minor: string
    training_commission_minor: string
    total_commission_minor: string
    recruitment_share_pct: string
    recruits: number
    product_sales: number
    training_sales: number
    clicks: number
    conversion_rate_pct: string
  }>(
    `select product_commission_minor::text, training_commission_minor::text,
            total_commission_minor::text, recruitment_share_pct::text,
            recruits, product_sales, training_sales, clicks, conversion_rate_pct::text
       from public.admin_affiliate_promotion_report(now() - interval '1 day', now() + interval '1 day')
      where affiliate_id = $1`,
    [affiliateId],
  )
  return rows[0]!
}

describe.skipIf(!HAS_DB)('is the programme selling or recruiting', () => {
  it('separates commission earned on training from commission earned on products', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const recruiter = await makeAffiliate(tx, by, 'Recruiter')

      // They recruit somebody into training: 30% of 40,000 = 12,000.
      const training = await makeTraining(tx, by)
      const recruit = await createUser(tx, { name: 'Recruit' })
      await click(tx, recruiter.account.affiliate_code, training, recruit.id)
      await buy(tx, recruit.id, training)

      // …and sell one real product: 30% of 20,000 = 6,000.
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      const customer = await createUser(tx, { name: 'Customer' })
      await click(tx, recruiter.account.affiliate_code, product, customer.id)
      await buy(tx, customer.id, product)

      const report = await reportFor(tx, recruiter.account.id)
      expect(Number(report.training_commission_minor)).toBe(12_000)
      expect(Number(report.product_commission_minor)).toBe(6_000)
      /* 12,000 of 18,000 = 66.7% of this person's income came from recruiting
         rather than selling. That single figure is what the Owner asked for,
         and it is also the first thing a regulator would want to see. */
      expect(Number(report.recruitment_share_pct)).toBeCloseTo(66.7, 1)
    })
  })

  it('counts recruits and sales separately', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const recruiter = await makeAffiliate(tx, by, 'Counter')
      const training = await makeTraining(tx, by)

      for (const name of ['R1', 'R2']) {
        const r = await createUser(tx, { name })
        await click(tx, recruiter.account.affiliate_code, training, r.id)
        await buy(tx, r.id, training)
      }

      const product = await makeProduct(tx, by)
      const customer = await createUser(tx, { name: 'One Customer' })
      await click(tx, recruiter.account.affiliate_code, product, customer.id)
      await buy(tx, customer.id, product)

      const report = await reportFor(tx, recruiter.account.id)
      expect([report.recruits, report.training_sales, report.product_sales]).toEqual([2, 2, 1])
    })
  })

  it('reports zero for somebody who has never promoted anything', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const idle = await makeAffiliate(tx, by, 'Idle')
      const report = await reportFor(tx, idle.account.id)

      expect([
        Number(report.total_commission_minor),
        report.clicks,
        report.recruits,
        Number(report.conversion_rate_pct),
      ]).toEqual([0, 0, 0, 0])
    })
  })

  it('shows clicks that never converted, which is a different problem', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const promoter = await makeAffiliate(tx, by, 'Lots Of Clicks')
      const product = await makeProduct(tx, by)

      for (let i = 0; i < 4; i += 1) {
        const visitor = await createUser(tx, { name: `Visitor ${i}` })
        await click(tx, promoter.account.affiliate_code, product, visitor.id)
      }

      const report = await reportFor(tx, promoter.account.id)
      /* Four clicks and no sales says the message is not working. No clicks at
         all says nobody is sharing anything. They need different conversations,
         which is why both are on the report. */
      expect(report.clicks).toBe(4)
      expect(Number(report.conversion_rate_pct)).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('refunded money does not count as earned', () => {
  it('drops out of the promotion report after a reversal', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Refunded Seller')
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      const customer = await createUser(tx, { name: 'Refund Customer' })
      await click(tx, seller.account.affiliate_code, product, customer.id)
      const order = await buy(tx, customer.id, product)

      expect(Number((await reportFor(tx, seller.account.id)).product_commission_minor)).toBe(6_000)

      await tx.query(`select public.refund_product_order($1, $2, 'returned')`, [order, by])

      /* Net of reversals. A report counting money later taken back credits
         somebody for a sale that did not happen — and on a leaderboard it is
         also farmable, which Phase 1 found out the hard way. */
      expect(Number((await reportFor(tx, seller.account.id)).product_commission_minor)).toBe(0)
    })
  })

  it('is net of reversals in the programme-wide share too', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Share Seller')
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      const customer = await createUser(tx, { name: 'Share Customer' })
      await click(tx, seller.account.affiliate_code, product, customer.id)
      const order = await buy(tx, customer.id, product)

      const before = await tx
        .query<{ product_minor: string }>(
          `select product_minor::text from public.affiliate_recruitment_share(
             now() - interval '1 day', now() + interval '1 day')`,
        )
        .then((r) => Number(r.rows[0]!.product_minor))

      await tx.query(`select public.refund_product_order($1, $2, 'returned')`, [order, by])

      const after = await tx
        .query<{ product_minor: string }>(
          `select product_minor::text from public.affiliate_recruitment_share(
             now() - interval '1 day', now() + interval '1 day')`,
        )
        .then((r) => Number(r.rows[0]!.product_minor))

      expect(before - after).toBe(6_000)
    })
  })
})

describe.skipIf(!HAS_DB)('earnings by year', () => {
  it('separates gross, reversed, net and paid out', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const seller = await makeAffiliate(tx, by, 'Yearly')
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })

      const first = await createUser(tx, { name: 'First Customer' })
      await click(tx, seller.account.affiliate_code, product, first.id)
      await buy(tx, first.id, product)

      const second = await createUser(tx, { name: 'Second Customer' })
      const product2 = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      await click(tx, seller.account.affiliate_code, product2, second.id)
      const refunded = await buy(tx, second.id, product2)
      await tx.query(`select public.refund_product_order($1, $2, 'returned')`, [refunded, by])

      const { rows } = await tx.query<{
        gross_minor: string
        reversed_minor: string
        net_minor: string
      }>(
        `select gross_minor::text, reversed_minor::text, net_minor::text
           from public.affiliate_earnings_by_year(extract(year from now())::int)
          where affiliate_id = $1`,
        [seller.account.id],
      )

      /* Gross counts the training commission the seller earned on their own
         purchase route too — what matters is that the three numbers agree:
         net = gross + reversed, with reversals stored negative. */
      const gross = Number(rows[0]!.gross_minor)
      const reversed = Number(rows[0]!.reversed_minor)
      const net = Number(rows[0]!.net_minor)

      expect(reversed).toBe(-6_000)
      expect(net).toBe(gross + reversed)
    })
  })
})
