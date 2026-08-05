import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Phase 2, step 3b: the money path for orders.
 *
 * These are the tests that cost real money when they are missing. Three
 * failures are being guarded against specifically, and each has already
 * happened once somewhere in Phase 1:
 *
 *  - a retried webhook confirming twice, and paying twice
 *  - a client sending its own price, and buying a sale that ended
 *  - a refund leaving the content open, or closing content the buyer still
 *    owns through a different purchase
 *
 * The bundle case gets its own block because it is the only place where one
 * payment grants many things, and getting it wrong is silent: the buyer owns a
 * bundle and can open nothing.
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
  o: { price?: number; sale?: number | null; kind?: string; status?: string } = {},
) => {
  const { price = 20_000, sale = null, kind = 'course', status = 'published' } = o
  seq += 1
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products
       (kind, purpose, title, slug, price_minor, sale_price_minor, status, created_by)
     values ($1::public.product_kind, 'vendor_product', 'Thing', $2, $3, $4,
             $5::public.product_status, $6)
     returning id`,
    [kind, `money-${Date.now()}-${seq}`, price, sale, status, by],
  )
  return rows[0]!.id
}

const start = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ id: string; amount_minor: string; list_price_minor: string }>(
    `select id, amount_minor::text, list_price_minor::text
       from public.start_product_order($1, $2, 'paystack')`,
    [userId, productId],
  )
  return rows[0]!
}

const confirm = async (tx: Tx, orderId: string, ref: string) => {
  const { rows } = await tx.query<{ status: string }>(
    `select status::text from public.confirm_product_order($1, $2)`,
    [orderId, ref],
  )
  return rows[0]!.status
}

const owns = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ ok: boolean }>(`select public.has_entitlement($1, $2) as ok`, [
    userId,
    productId,
  ])
  return rows[0]!.ok
}

describe.skipIf(!HAS_DB)('starting an order', () => {
  it('takes the price from the server, including an active sale', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Shopper' })
      const product = await makeProduct(tx, by, { price: 20_000, sale: 12_000 })

      /* The caller never supplies a price. A client-supplied price is a
         client-supplied discount, and a sale that ended yesterday would still
         be honoured by whoever kept the page open. */
      const order = await start(tx, user.id, product)
      expect([Number(order.amount_minor), Number(order.list_price_minor)]).toEqual([12_000, 20_000])
    })
  })

  it('refuses a product that is not on sale', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Early Bird' })
      const draft = await makeProduct(tx, by, { status: 'draft' })
      const message = await expectRejection(tx, () => start(tx, user.id, draft))
      expect(message).toMatch(/not on sale/i)
    })
  })

  it('refuses to sell somebody what they already own', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Repeat Buyer' })
      const product = await makeProduct(tx, by)
      const first = await start(tx, user.id, product)
      await confirm(tx, first.id, `REF-${Date.now()}-1`)

      /* Taking the money and granting nothing is the failure this prevents —
         the entitlement upsert would silently make the second payment buy
         exactly nothing. */
      const message = await expectRejection(tx, () => start(tx, user.id, product))
      expect(message).toMatch(/already own/i)
    })
  })

  it('refuses a disabled account', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Disabled Buyer' })
      const product = await makeProduct(tx, by)
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [user.id])
      const message = await expectRejection(tx, () => start(tx, user.id, product))
      expect(message).toMatch(/disabled/i)
    })
  })
})

describe.skipIf(!HAS_DB)('confirming a payment', () => {
  it('confirms once and grants access', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Payer' })
      const product = await makeProduct(tx, by)
      const order = await start(tx, user.id, product)

      expect(await owns(tx, user.id, product)).toBe(false)
      expect(await confirm(tx, order.id, `REF-${Date.now()}-a`)).toBe('confirmed')
      expect(await owns(tx, user.id, product)).toBe(true)
    })
  })

  it('is idempotent when the same webhook arrives twice', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Retried' })
      const product = await makeProduct(tx, by)
      const order = await start(tx, user.id, product)
      const ref = `REF-${Date.now()}-b`

      await confirm(tx, order.id, ref)
      /* A retried delivery is not an error and must not raise. Phase 1 files
         unexplained faults in Sentry, and an expected retry raising there is
         how a real failure gets lost in the noise. */
      expect(await confirm(tx, order.id, ref)).toBe('confirmed')

      const { rows } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.entitlements where user_id = $1 and product_id = $2`,
        [user.id, product],
      )
      expect(Number(rows[0]!.n)).toBe(1)
    })
  })

  it('refuses a second confirmation under a DIFFERENT reference', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Two Refs' })
      const product = await makeProduct(tx, by)
      const order = await start(tx, user.id, product)

      await confirm(tx, order.id, `REF-${Date.now()}-c1`)
      // Two references against one order is not a retry — it is two payments
      // or a mistake, and either way it needs a human.
      const message = await expectRejection(tx, () =>
        confirm(tx, order.id, `REF-${Date.now()}-c2`),
      )
      expect(message).toMatch(/already confirmed with another reference/i)
    })
  })

  it('refuses to confirm an order that was refunded', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Refunded Then Paid' })
      const product = await makeProduct(tx, by)
      const order = await start(tx, user.id, product)
      await confirm(tx, order.id, `REF-${Date.now()}-d`)
      await tx.query(`select public.refund_product_order($1, $2, 'test')`, [order.id, by])

      const message = await expectRejection(tx, () => confirm(tx, order.id, `REF-x`))
      expect(message).toMatch(/cannot be confirmed/i)
    })
  })
})

describe.skipIf(!HAS_DB)('a bundle is one payment and many entitlements', () => {
  it('grants the bundle and everything inside it', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Bundle Buyer' })
      const bundle = await makeProduct(tx, by, { kind: 'bundle', price: 30_000 })
      const a = await makeProduct(tx, by, { price: 20_000 })
      const b = await makeProduct(tx, by, { price: 15_000 })
      await tx.query(
        `insert into public.bundle_items (bundle_product_id, product_id) values ($1, $2), ($1, $3)`,
        [bundle, a, b],
      )

      const order = await start(tx, user.id, bundle)
      await confirm(tx, order.id, `REF-${Date.now()}-e`)

      /* The silent failure this guards: owning a bundle and being able to open
         nothing. Commission is one row; access is many. */
      expect([
        await owns(tx, user.id, bundle),
        await owns(tx, user.id, a),
        await owns(tx, user.id, b),
      ]).toEqual([true, true, true])
    })
  })

  it('charges the bundle price, not the sum of its contents', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Bundle Price' })
      const bundle = await makeProduct(tx, by, { kind: 'bundle', price: 30_000 })
      const a = await makeProduct(tx, by, { price: 20_000 })
      const b = await makeProduct(tx, by, { price: 15_000 })
      await tx.query(
        `insert into public.bundle_items (bundle_product_id, product_id) values ($1, $2), ($1, $3)`,
        [bundle, a, b],
      )

      const order = await start(tx, user.id, bundle)
      // 30,000 — not 35,000. A bundle pays its own rate on its own price.
      expect(Number(order.amount_minor)).toBe(30_000)
    })
  })
})

describe.skipIf(!HAS_DB)('refunding', () => {
  it('revokes access immediately', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Refunder' })
      const product = await makeProduct(tx, by)
      const order = await start(tx, user.id, product)
      await confirm(tx, order.id, `REF-${Date.now()}-f`)
      expect(await owns(tx, user.id, product)).toBe(true)

      // Operator decision: they have their money back, so they no longer have
      // the product. A grace period would make "refund then binge" free rental.
      await tx.query(`select public.refund_product_order($1, $2, 'changed their mind')`, [
        order.id,
        by,
      ])
      expect(await owns(tx, user.id, product)).toBe(false)
    })
  })

  it('leaves access that a DIFFERENT purchase still pays for', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Owns It Twice' })
      const course = await makeProduct(tx, by, { price: 20_000 })
      const bundle = await makeProduct(tx, by, { kind: 'bundle', price: 30_000 })
      await tx.query(
        `insert into public.bundle_items (bundle_product_id, product_id) values ($1, $2)`,
        [bundle, course],
      )

      const standalone = await start(tx, user.id, course)
      await confirm(tx, standalone.id, `REF-${Date.now()}-g1`)

      const bundleOrder = await start(tx, user.id, bundle)
      await confirm(tx, bundleOrder.id, `REF-${Date.now()}-g2`)

      /* The entitlement now points at the BUNDLE order, because that granted
         it most recently. Refunding the standalone purchase must therefore
         take nothing away — they still own the course through the bundle they
         kept. Revoking by product rather than by order would have removed
         access they are still paying for. */
      await tx.query(`select public.refund_product_order($1, $2, 'duplicate')`, [standalone.id, by])
      expect(await owns(tx, user.id, course)).toBe(true)
    })
  })

  it('needs a reason, and is written to the audit trail', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Audited' })
      const product = await makeProduct(tx, by)
      const order = await start(tx, user.id, product)
      await confirm(tx, order.id, `REF-${Date.now()}-h`)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.refund_product_order($1, $2, '  ')`, [order.id, by]),
      )
      expect(message).toMatch(/needs a reason/i)

      await tx.query(`select public.refund_product_order($1, $2, 'faulty video')`, [order.id, by])
      const { rows } = await tx.query<{ n: string; reason: string }>(
        `select count(*)::text n, max(new_values->>'reason') as reason
           from public.admin_audit_log
          where action = 'refund_order' and entity_id = $1`,
        [order.id],
      )
      expect([Number(rows[0]!.n), rows[0]!.reason]).toEqual([1, 'faulty video'])
    })
  })

  it('is idempotent, and refuses an order that was never confirmed', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Twice Refunded' })
      const product = await makeProduct(tx, by)
      const order = await start(tx, user.id, product)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.refund_product_order($1, $2, 'never paid')`, [order.id, by]),
      )
      expect(message).toMatch(/only a confirmed order/i)

      await confirm(tx, order.id, `REF-${Date.now()}-i`)
      await tx.query(`select public.refund_product_order($1, $2, 'first')`, [order.id, by])
      await tx.query(`select public.refund_product_order($1, $2, 'second')`, [order.id, by])

      const { rows } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.admin_audit_log
          where action = 'refund_order' and entity_id = $1`,
        [order.id],
      )
      // The second call returns quietly rather than raising or logging again.
      expect(Number(rows[0]!.n)).toBe(1)
    })
  })
})
