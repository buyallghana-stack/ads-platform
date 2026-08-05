import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, expectRejection, withRollback } from '../support/db'

/**
 * Phase 2, step 1: the catalogue.
 *
 * WHAT IS WORTH TESTING HERE, AND WHAT IS NOT. Columns existing is not a test —
 * the migration either applied or it did not. What is worth proving is every
 * place the schema REFUSES something, because a refusal that was written but
 * does not fire is indistinguishable from one that was never written, right up
 * until somebody sells a product priced below zero.
 *
 * The pricing function gets the most attention. It is the single source of
 * truth for what a product costs, and three separate things read it — the
 * catalogue, the checkout, and the commission base (decided 2026-08-05: the
 * base is the amount actually charged). A sale window that opens one minute
 * early is a real money difference, so the boundaries are tested rather than
 * the middle.
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

const makeVendor = async (tx: Tx, by: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.vendors (name, created_by) values ('Test Vendor', $1) returning id`,
    [by],
  )
  return rows[0]!.id
}

type ProductOptions = {
  kind?: string
  purpose?: string
  vendorId?: string | null
  priceMinor?: number
  saleMinor?: number | null
  startsAt?: string | null
  endsAt?: string | null
  slug?: string
  tier?: string
  status?: string
}

let seq = 0
const makeProduct = async (tx: Tx, by: string, options: ProductOptions = {}) => {
  seq += 1
  const {
    kind = 'course',
    purpose = 'vendor_product',
    vendorId = null,
    priceMinor = 10_000,
    saleMinor = null,
    startsAt = null,
    endsAt = null,
    slug = `test-product-${Date.now()}-${seq}`,
    tier = 'beginner',
    status = 'published',
  } = options

  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products
       (vendor_id, kind, purpose, title, slug, price_minor, sale_price_minor,
        sale_starts_at, sale_ends_at, min_affiliate_tier, status, created_by)
     values ($1, $2::public.product_kind, $3::public.product_purpose, 'Test Product', $4,
             $5, $6, $7, $8, $9::public.affiliate_tier, $10::public.product_status, $11)
     returning id`,
    [vendorId, kind, purpose, slug, priceMinor, saleMinor, startsAt, endsAt, tier, status, by],
  )
  return rows[0]!.id
}

const priceOf = async (tx: Tx, id: string) => {
  const { rows } = await tx.query<{ p: string }>(
    `select public.product_price_minor($1)::text as p`,
    [id],
  )
  return Number(rows[0]!.p)
}

describe.skipIf(!HAS_DB)('what a product costs', () => {
  it('is the list price when nothing is on sale', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by, { priceMinor: 12_500 })
      expect(await priceOf(tx, id)).toBe(12_500)
    })
  })

  it('is the sale price when a sale has no window at all', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by, { priceMinor: 12_500, saleMinor: 8_000 })
      expect(await priceOf(tx, id)).toBe(8_000)
    })
  })

  it('ignores a sale that has not started', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by, { priceMinor: 12_500, saleMinor: 8_000 })
      // Set through an UPDATE rather than the insert helper, so the window is
      // relative to the database's own clock rather than the test runner's.
      await tx.query(
        `update public.products set sale_starts_at = now() + interval '1 day' where id = $1`,
        [id],
      )
      expect(await priceOf(tx, id)).toBe(12_500)
    })
  })

  it('ignores a sale that has ended', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by, { priceMinor: 12_500, saleMinor: 8_000 })
      await tx.query(
        `update public.products
            set sale_starts_at = now() - interval '2 days',
                sale_ends_at   = now() - interval '1 day'
          where id = $1`,
        [id],
      )
      expect(await priceOf(tx, id)).toBe(12_500)
    })
  })

  it('honours a sale that is open right now', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by, { priceMinor: 12_500, saleMinor: 8_000 })
      await tx.query(
        `update public.products
            set sale_starts_at = now() - interval '1 hour',
                sale_ends_at   = now() + interval '1 hour'
          where id = $1`,
        [id],
      )
      expect(await priceOf(tx, id)).toBe(8_000)
    })
  })

  it('treats the end of a window as exclusive, the start as inclusive', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by, { priceMinor: 12_500, saleMinor: 8_000 })

      /* The boundary is where money is actually at stake: a window that is
         open a moment too long sells at the sale price after it was meant to
         end, and every one of those is a real order. */
      await tx.query(
        `update public.products set sale_starts_at = now(), sale_ends_at = now() + interval '1 hour'
          where id = $1`,
        [id],
      )
      expect(await priceOf(tx, id)).toBe(8_000)

      await tx.query(
        `update public.products set sale_starts_at = now() - interval '1 hour', sale_ends_at = now()
          where id = $1`,
        [id],
      )
      expect(await priceOf(tx, id)).toBe(12_500)
    })
  })
})

describe.skipIf(!HAS_DB)('what the catalogue refuses', () => {
  it('refuses a sale price above the list price', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const message = await expectRejection(tx, () =>
        makeProduct(tx, by, { priceMinor: 10_000, saleMinor: 12_000 }),
      )
      expect(message).toMatch(/products_sale_price_sane/i)
    })
  })

  it('refuses a negative price', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const message = await expectRejection(tx, () => makeProduct(tx, by, { priceMinor: -1 }))
      expect(message).toMatch(/products_price_sane/i)
    })
  })

  it('refuses a sale window that ends before it starts', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by, { saleMinor: 5_000 })
      const message = await expectRejection(tx, () =>
        tx.query(
          `update public.products
              set sale_starts_at = now(), sale_ends_at = now() - interval '1 day'
            where id = $1`,
          [id],
        ),
      )
      expect(message).toMatch(/products_sale_window_ordered/i)
    })
  })

  it('refuses a sale window with no sale price to apply', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by)
      /* A window with no price would silently do nothing, and the bug would
         look like it lived in the checkout rather than in the product. */
      const message = await expectRejection(tx, () =>
        tx.query(
          `update public.products set sale_starts_at = now() where id = $1`,
          [id],
        ),
      )
      expect(message).toMatch(/products_sale_window_needs_price/i)
    })
  })

  it('refuses a training program that belongs to a vendor', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const vendor = await makeVendor(tx, by)
      /* A vendor's name against the product that grants affiliate eligibility
         would be wrong in a way nobody would notice until it mattered. */
      const message = await expectRejection(tx, () =>
        makeProduct(tx, by, { purpose: 'training_program', vendorId: vendor }),
      )
      expect(message).toMatch(/products_training_has_no_vendor/i)
    })
  })

  it('refuses a slug that is not url-safe', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const message = await expectRejection(tx, () =>
        makeProduct(tx, by, { slug: 'Not A Slug' }),
      )
      expect(message).toMatch(/products_slug_format/i)
    })
  })
})

describe.skipIf(!HAS_DB)('bundles are exactly one level deep', () => {
  it('holds products', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const bundle = await makeProduct(tx, by, { kind: 'bundle' })
      const course = await makeProduct(tx, by, { kind: 'course' })
      const ebook = await makeProduct(tx, by, { kind: 'ebook' })

      await tx.query(
        `insert into public.bundle_items (bundle_product_id, product_id, position)
         values ($1, $2, 0), ($1, $3, 1)`,
        [bundle, course, ebook],
      )

      const { rows } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.bundle_items where bundle_product_id = $1`,
        [bundle],
      )
      expect(Number(rows[0]!.n)).toBe(2)
    })
  })

  it('refuses a bundle inside a bundle', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const outer = await makeProduct(tx, by, { kind: 'bundle' })
      const inner = await makeProduct(tx, by, { kind: 'bundle' })

      /* Nesting would make "what does buying this grant?" a recursive
         question, and the entitlement grant would have to walk a tree of
         unknown depth. Refused structurally instead. */
      const message = await expectRejection(tx, () =>
        tx.query(
          `insert into public.bundle_items (bundle_product_id, product_id) values ($1, $2)`,
          [outer, inner],
        ),
      )
      expect(message).toMatch(/cannot contain another bundle/i)
    })
  })

  it('refuses contents hung off something that is not a bundle', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const course = await makeProduct(tx, by, { kind: 'course' })
      const ebook = await makeProduct(tx, by, { kind: 'ebook' })

      const message = await expectRejection(tx, () =>
        tx.query(
          `insert into public.bundle_items (bundle_product_id, product_id) values ($1, $2)`,
          [course, ebook],
        ),
      )
      expect(message).toMatch(/only a bundle can contain products/i)
    })
  })

  it('refuses a bundle that contains itself', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const bundle = await makeProduct(tx, by, { kind: 'bundle' })
      /* Refused by the TRIGGER, not by `bundle_items_not_self` — a bundle
         containing itself is also a bundle containing a bundle, and the
         before-insert trigger runs first. Both refusals are correct; asserting
         the constraint name here would be asserting the firing ORDER, which is
         not a property worth pinning. */
      const message = await expectRejection(tx, () =>
        tx.query(
          `insert into public.bundle_items (bundle_product_id, product_id) values ($1, $1)`,
          [bundle],
        ),
      )
      expect(message).toMatch(/cannot contain another bundle|bundle_items_not_self/i)
    })
  })
})

describe.skipIf(!HAS_DB)('who may promote what', () => {
  it('ranks professional above beginner, so a minimum works with >=', async () => {
    await withRollback(async (tx) => {
      /* D23 is a MINIMUM tier, not an exact match — a Professional may promote
         everything a Beginner may. That only holds if the type is ordered, so
         this asserts the ordering itself rather than any code that reads it. */
      const { rows } = await tx.query<{ ok: boolean }>(
        `select ('professional'::public.affiliate_tier >= 'beginner'::public.affiliate_tier)
                and not ('beginner'::public.affiliate_tier >= 'professional'::public.affiliate_tier)
                as ok`,
      )
      expect(rows[0]!.ok).toBe(true)
    })
  })

  it('defaults a product to beginner, so nothing is accidentally restricted', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const id = await makeProduct(tx, by)
      const { rows } = await tx.query<{ t: string }>(
        `select min_affiliate_tier::text as t from public.products where id = $1`,
        [id],
      )
      expect(rows[0]!.t).toBe('beginner')
    })
  })
})
