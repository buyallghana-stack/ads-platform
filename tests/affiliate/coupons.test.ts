import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Coupons on the affiliate side, where the money moves in two directions at
 * once: the buyer pays less, and somebody else is paid for the sale.
 *
 * Operator, 2026-08-11: an affiliate's commission must not shrink because the
 * platform ran a promotion. So the commission base is the price BEFORE the
 * coupon, which breaks a guarantee the ledger was built on: that commission
 * can never exceed what the sale brought in. The guard on coupon creation is
 * the only thing keeping that bounded, so it is tested here beside the rule
 * that made it necessary.
 */

const superAdmin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

/** A training product, its commission programme, and its training row. */
const makeTraining = async (
  tx: Tx,
  by: string,
  o: { price?: number; l1?: number; l2?: number } = {},
) => {
  const { price = 15_000, l1 = 20, l2 = 5 } = o
  seq += 1
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products
       (kind, purpose, title, slug, price_minor, status, min_affiliate_tier, created_by)
     values ('course', 'training_program', 'Coupon Training', $1, $2, 'published', 'beginner', $3)
     returning id`,
    [`coupon-training-${Date.now()}-${seq}`, price, by],
  )
  const productId = rows[0]!.id

  await tx.query(
    `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value, attribution_window_hours)
     values ($1, $2, $3, 720)`,
    [productId, l1, l2],
  )
  await tx.query(
    `insert into public.training_programs
       (product_id, level, commission_depth, activation_threshold_percent, quiz_required)
     values ($1, 'professional', 2, 0, false)`,
    [productId],
  )
  return productId
}

const makeCoupon = async (
  tx: Tx,
  by: string,
  productId: string,
  o: { percent?: number | null; amountMinor?: number | null; code?: string } = {},
) => {
  seq += 1
  const { percent = 20, amountMinor = null, code = `AFF${Date.now().toString(36)}${seq}`.toUpperCase() } = o
  await tx.query(
    `select public.admin_save_coupon(
       $1, null, $2, 'affiliate', null, $3,
       $4::public.coupon_discount_kind, $5, $6, null, 0, 50, 1, true, null, null, true, 'test')`,
    [by, code, productId, amountMinor === null ? 'percent' : 'fixed', percent, amountMinor],
  )
  return code
}

const buy = async (tx: Tx, userId: string, productId: string, code?: string) => {
  const { rows } = await tx.query<{ id: string; amount_minor: string; list_price_minor: string }>(
    `select id, amount_minor::text, list_price_minor::text
       from public.start_product_order($1, $2, 'paystack', $3)`,
    [userId, productId, code ?? null],
  )
  const order = rows[0]!
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2, null)`, [
    order.id,
    `AFFCOUP-${Date.now()}-${seq}`,
  ])
  return {
    id: order.id,
    chargedMinor: Number(order.amount_minor),
    listMinor: Number(order.list_price_minor),
  }
}

/** An affiliate who owns the training and can therefore sell it. */
const makeSeller = async (tx: Tx, by: string) => {
  const user = await createUser(tx, { name: `Seller ${(seq += 1)}` })
  await buy(tx, user.id, await makeTraining(tx, by))
  const { rows } = await tx.query<{ id: string; affiliate_code: string }>(
    `select id, affiliate_code from public.affiliate_accounts where user_id = $1`,
    [user.id],
  )
  return { user, account: rows[0]! }
}

describe.skipIf(!HAS_DB)('a discounted sale still pays the affiliate in full', () => {
  it('works the commission out on the price before the coupon', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const seller = await makeSeller(tx, by)
      const product = await makeTraining(tx, by, { price: 15_000, l1: 20, l2: 5 })
      const code = await makeCoupon(tx, by, product, { percent: 20 })
      const buyer = await createUser(tx, { name: 'Discounted Buyer' })

      await tx.query(`select public.record_affiliate_click($1, $2, null, null, $3)`, [
        seller.account.affiliate_code,
        product,
        buyer.id,
      ])

      const order = await buy(tx, buyer.id, product, code)
      expect([order.chargedMinor, order.listMinor]).toEqual([12_000, 15_000])

      const { rows } = await tx.query<{ base_minor: string; credited: string }>(
        `select c.base_minor::text,
                (select amount_minor from public.commission_ledger
                  where conversion_id = c.id and level = 1)::text as credited
           from public.conversions c where c.order_id = $1`,
        [order.id],
      )

      /* The buyer paid GHS 120 and the affiliate is paid 20% of GHS 150. The
         operator's promotion costs the platform, never the person who made
         the sale. */
      expect([Number(rows[0]!.base_minor), Number(rows[0]!.credited)]).toEqual([15_000, 3_000])
    })
  })

  it('pays on the amount received when no coupon is involved', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const seller = await makeSeller(tx, by)
      const product = await makeTraining(tx, by, { price: 40_000, l1: 20, l2: 5 })
      const buyer = await createUser(tx, { name: 'Full Price Buyer' })

      await tx.query(`select public.record_affiliate_click($1, $2, null, null, $3)`, [
        seller.account.affiliate_code,
        product,
        buyer.id,
      ])
      const order = await buy(tx, buyer.id, product)

      /* Nothing about the old behaviour changed for a sale with no code on it,
         which is the property that made this safe to ship on a live ledger. */
      const { rows } = await tx.query<{ base_minor: string }>(
        `select base_minor::text from public.conversions where order_id = $1`,
        [order.id],
      )
      expect(Number(rows[0]!.base_minor)).toBe(40_000)
    })
  })
})

describe.skipIf(!HAS_DB)('the guard that rule created', () => {
  it('refuses a discount deeper than the commission it would pay', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      /* 20 and 5 means 25% goes out on every sale, so anything past 75% off
         pays out more than comes in. Refused at creation rather than at the
         till, because by then somebody has printed it on a flyer. */
      const product = await makeTraining(tx, by, { l1: 20, l2: 5 })

      const message = await expectRejection(tx, () => makeCoupon(tx, by, product, { percent: 90 }))
      expect(message).toMatch(/more commission than the sale brings in/i)
      expect(message).toMatch(/75 percent/)
    })
  })

  it('allows one right at the edge', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await makeTraining(tx, by, { l1: 20, l2: 5 })
      const code = await makeCoupon(tx, by, product, { percent: 75 })

      const user = await createUser(tx, { name: 'Edge Case' })
      const { rows } = await tx.query<{ ok: boolean; charged_minor: string }>(
        `select ok, charged_minor::text from public.coupon_quote($1, $2, null, $3, 15000)`,
        [user.id, code, product],
      )
      expect([rows[0]!.ok, Number(rows[0]!.charged_minor)]).toEqual([true, 3_750])
    })
  })

  it('measures a fixed discount against the price too', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await makeTraining(tx, by, { price: 10_000, l1: 20, l2: 5 })

      /* GHS 90 off a GHS 100 programme is 90%, however it is written. */
      const message = await expectRejection(tx, () =>
        makeCoupon(tx, by, product, { percent: null, amountMinor: 9_000 }),
      )
      expect(message).toMatch(/more commission than the sale brings in/i)
    })
  })
})
