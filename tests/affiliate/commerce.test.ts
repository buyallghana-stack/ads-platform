import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Phase 2, step 3a: orders and entitlements — the tables.
 *
 * The confirm / grant / refund functions are gate G4 and are not built yet.
 * What is testable now is the shape those functions will have to work inside,
 * and that shape is doing real work: an order that cannot disagree with its
 * own timestamps, a provider reference that cannot confirm twice, and one
 * entitlement row per person per product no matter which of the three flows
 * granted it.
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0
const makeProduct = async (tx: Tx, by: string, priceMinor = 20_000) => {
  seq += 1
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'vendor_product', 'A Course', $1, $2, 'published', $3) returning id`,
    [`order-course-${Date.now()}-${seq}`, priceMinor, by],
  )
  return rows[0]!.id
}

type OrderOptions = {
  kind?: string
  amount?: number
  list?: number
  ref?: string | null
  status?: string
  confirmed?: boolean
  refunded?: boolean
}

const makeOrder = async (tx: Tx, userId: string, productId: string, o: OrderOptions = {}) => {
  const {
    kind = 'purchase',
    amount = 20_000,
    list = 20_000,
    ref = null,
    status = 'pending',
    confirmed = false,
    refunded = false,
  } = o
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.orders
       (user_id, product_id, kind, amount_minor, list_price_minor, method,
        provider_ref, status, confirmed_at, refunded_at)
     values ($1, $2, $3::public.order_kind, $4, $5, 'paystack', $6,
             $7::public.order_status,
             case when $8 then now() end,
             case when $9 then now() end)
     returning id`,
    [userId, productId, kind, amount, list, ref, status, confirmed, refunded],
  )
  return rows[0]!.id
}

describe.skipIf(!HAS_DB)('an order cannot contradict itself', () => {
  it('records what was charged and what it would have cost', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Buyer' })
      const product = await makeProduct(tx, by, 20_000)

      // A sale: charged 12,000 against a 20,000 list price.
      const id = await makeOrder(tx, user.id, product, { amount: 12_000, list: 20_000 })

      const { rows } = await tx.query<{ amount_minor: string; list_price_minor: string }>(
        `select amount_minor::text, list_price_minor::text from public.orders where id = $1`,
        [id],
      )
      /* Both, because commission is charged on the AMOUNT (decided
         2026-08-05) while the list price is what a discount report needs. */
      expect([Number(rows[0]!.amount_minor), Number(rows[0]!.list_price_minor)]).toEqual([
        12_000, 20_000,
      ])
    })
  })

  it('refuses charging more than the list price', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Overcharged' })
      const product = await makeProduct(tx, by)
      /* Not a discount, an upgrade or a renewal — an inverted assignment.
         Caught at the write rather than in a commission figure queried weeks
         later. */
      const message = await expectRejection(tx, () =>
        makeOrder(tx, user.id, product, { amount: 30_000, list: 20_000 }),
      )
      expect(message).toMatch(/orders_amount_not_above_list/i)
    })
  })

  it('refuses a confirmed order with no confirmation time', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Half Confirmed' })
      const product = await makeProduct(tx, by)
      const message = await expectRejection(tx, () =>
        makeOrder(tx, user.id, product, { status: 'confirmed', confirmed: false }),
      )
      expect(message).toMatch(/orders_confirmed_has_time/i)
    })
  })

  it('refuses a refund on something never confirmed', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Impossible Refund' })
      const product = await makeProduct(tx, by)
      const message = await expectRejection(tx, () =>
        makeOrder(tx, user.id, product, { status: 'refunded', confirmed: false, refunded: true }),
      )
      expect(message).toMatch(/orders_refunded_was_confirmed/i)
    })
  })

  it('accepts a properly refunded order', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Real Refund' })
      const product = await makeProduct(tx, by)
      const id = await makeOrder(tx, user.id, product, {
        status: 'refunded',
        confirmed: true,
        refunded: true,
      })
      expect(id).toBeTruthy()
    })
  })
})

describe.skipIf(!HAS_DB)('one provider reference confirms one order', () => {
  it('refuses a second order carrying the same reference', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Webhook Retry' })
      const product = await makeProduct(tx, by)
      const ref = `PSTK-${Date.now()}`

      await makeOrder(tx, user.id, product, { ref, status: 'confirmed', confirmed: true })

      /* This index is what makes a replayed Paystack webhook harmless. It is
         the same guard Phase 1 relies on, and it is the reason a retried
         delivery cannot pay a second commission. */
      const message = await expectRejection(tx, () =>
        makeOrder(tx, user.id, product, { ref, status: 'confirmed', confirmed: true }),
      )
      expect(message).toMatch(/orders_provider_ref_idx/i)
    })
  })

  it('allows many pending orders, which have no reference yet', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Abandoner' })
      const product = await makeProduct(tx, by)

      /* Phase 1 taught this one: a payment row is created BEFORE the card
         form, so an abandoned checkout leaves a pending row nothing closes.
         Several of those must be legal, or a user who wanders off twice
         cannot buy anything on the third try. */
      await makeOrder(tx, user.id, product)
      await makeOrder(tx, user.id, product)
      await makeOrder(tx, user.id, product)

      const { rows } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.orders where user_id = $1 and status = 'pending'`,
        [user.id],
      )
      expect(Number(rows[0]!.n)).toBe(3)
    })
  })
})

describe.skipIf(!HAS_DB)('one entitlement per person per product', () => {
  it('upserts rather than duplicating when granted twice', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Double Granted' })
      const product = await makeProduct(tx, by)
      const first = await makeOrder(tx, user.id, product, { status: 'confirmed', confirmed: true })
      const second = await makeOrder(tx, user.id, product, {
        ref: `PSTK-${Date.now()}-b`,
        status: 'confirmed',
        confirmed: true,
      })

      /* Three flows can grant the same product to the same person: buying it,
         buying a bundle containing it, and renewing. Without the unique key
         those make two or three rows and a reader has to guess which is
         authoritative. */
      await tx.query(
        `insert into public.entitlements (user_id, product_id, order_id) values ($1, $2, $3)`,
        [user.id, product, first],
      )
      await tx.query(
        `insert into public.entitlements (user_id, product_id, order_id) values ($1, $2, $3)
         on conflict (user_id, product_id) do update set order_id = excluded.order_id`,
        [user.id, product, second],
      )

      const { rows } = await tx.query<{ n: string; order_id: string }>(
        `select count(*)::text n, max(order_id::text) as order_id from public.entitlements
          where user_id = $1 and product_id = $2`,
        [user.id, product],
      )
      expect(Number(rows[0]!.n)).toBe(1)
      expect(rows[0]!.order_id).toBe(second)
    })
  })
})

describe.skipIf(!HAS_DB)('whether somebody may open a product', () => {
  const owns = async (tx: Tx, userId: string, productId: string) => {
    const { rows } = await tx.query<{ ok: boolean }>(
      `select public.has_entitlement($1, $2) as ok`,
      [userId, productId],
    )
    return rows[0]!.ok
  }

  it('says no when they have never bought it', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Window Shopper' })
      const product = await makeProduct(tx, by)
      expect(await owns(tx, user.id, product)).toBe(false)
    })
  })

  it('says yes for a permanent entitlement', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Owner' })
      const product = await makeProduct(tx, by)
      const order = await makeOrder(tx, user.id, product, { status: 'confirmed', confirmed: true })
      await tx.query(
        `insert into public.entitlements (user_id, product_id, order_id) values ($1, $2, $3)`,
        [user.id, product, order],
      )
      expect(await owns(tx, user.id, product)).toBe(true)
    })
  })

  it('says no once it has expired, and no when it is revoked', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Lapsed' })
      const product = await makeProduct(tx, by)
      const order = await makeOrder(tx, user.id, product, { status: 'confirmed', confirmed: true })

      await tx.query(
        `insert into public.entitlements (user_id, product_id, order_id, expires_at)
         values ($1, $2, $3, now() - interval '1 day')`,
        [user.id, product, order],
      )
      expect(await owns(tx, user.id, product)).toBe(false)

      await tx.query(
        `update public.entitlements set expires_at = now() + interval '30 days', status = 'revoked'
          where user_id = $1 and product_id = $2`,
        [user.id, product],
      )
      // Unexpired but revoked must still be a no, or a refund would leave the
      // content open.
      expect(await owns(tx, user.id, product)).toBe(false)
    })
  })
})
