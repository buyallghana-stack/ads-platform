import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Phase 2, step 5: clicks and attribution.
 *
 * No money moves in this step, but every decision about WHO gets paid is made
 * here and frozen. That makes these the tests that decide whether a payment
 * argument a year from now is answerable or arguable.
 *
 * Four rules get the most attention, because each one is an exploit if it
 * fails: self-referral, renewals paying nobody, the attribution window, and
 * level two being resolved at the moment of the sale rather than looked up
 * afterwards.
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
  o: { price?: number; purpose?: string; tier?: string; l1?: number; l2?: number; window?: number } = {},
) => {
  const { price = 20_000, purpose = 'vendor_product', tier = 'beginner', l1 = 30, l2 = 10, window = 720 } = o
  seq += 1
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products
       (kind, purpose, title, slug, price_minor, status, min_affiliate_tier, created_by)
     values ('course', $1::public.product_purpose, 'Thing', $2, $3, 'published',
             $4::public.affiliate_tier, $5)
     returning id`,
    [purpose, `attr-${Date.now()}-${seq}`, price, tier, by],
  )
  const productId = rows[0]!.id
  await tx.query(
    `insert into public.affiliate_programs
       (product_id, l1_rate_value, l2_rate_value, attribution_window_hours)
     values ($1, $2, $3, $4)`,
    [productId, l1, l2, window],
  )
  return productId
}

/** A training product plus its program, activating on purchase. */
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

const buy = async (tx: Tx, userId: string, productId: string, visitorToken: string | null = null) => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.start_product_order($1, $2, 'paystack')`,
    [userId, productId],
  )
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2, $3)`, [
    rows[0]!.id,
    `ATTR-${Date.now()}-${seq}`,
    visitorToken,
  ])
  return rows[0]!.id
}

const accountOf = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ id: string; affiliate_code: string; parent_affiliate_id: string | null }>(
    `select id, affiliate_code, parent_affiliate_id from public.affiliate_accounts where user_id = $1`,
    [userId],
  )
  return rows[0] ?? null
}

const click = async (
  tx: Tx,
  code: string,
  productId: string,
  o: { subid?: string | null; token?: string | null; userId?: string | null } = {},
) => {
  const { subid = null, token = null, userId = null } = o
  const { rows } = await tx.query<{ id: string }>(
    `select public.record_affiliate_click($1, $2, $3, $4, $5) as id`,
    [code, productId, subid, token, userId],
  )
  return rows[0]!.id
}

const conversionFor = async (tx: Tx, orderId: string) => {
  const { rows } = await tx.query<{
    affiliate_id: string
    l1_rate: string
    l2_affiliate_id: string | null
    l2_rate: string | null
    l2_depth_at_conversion: number | null
    base_minor: string
    subid: string | null
  }>(
    `select affiliate_id, l1_rate::text, l2_affiliate_id, l2_rate::text,
            l2_depth_at_conversion, base_minor::text, subid
       from public.conversions where order_id = $1`,
    [orderId],
  )
  return rows[0] ?? null
}

/** An activated affiliate holding the given tier. */
const makeAffiliate = async (tx: Tx, by: string, name: string, level = 'professional') => {
  const user = await createUser(tx, { name })
  const training = await makeTraining(tx, by, level)
  await buy(tx, user.id, training)
  return { user, account: (await accountOf(tx, user.id))! }
}

describe.skipIf(!HAS_DB)('recording a click', () => {
  it('records one for an active affiliate', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { account } = await makeAffiliate(tx, by, 'Promoter')
      const product = await makeProduct(tx, by)

      const id = await click(tx, account.affiliate_code, product, { subid: 'whatsapp-status' })
      const { rows } = await tx.query<{ subid: string }>(
        `select subid from public.affiliate_clicks where id = $1`,
        [id],
      )
      expect(rows[0]!.subid).toBe('whatsapp-status')
    })
  })

  it('refuses an unknown link', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const product = await makeProduct(tx, by)
      const message = await expectRejection(tx, () => click(tx, 'NOSUCHCODE', product))
      expect(message).toMatch(/unknown affiliate link/i)
    })
  })

  it('refuses a Beginner promoting a Professional-only product', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { account } = await makeAffiliate(tx, by, 'Just A Beginner', 'beginner')
      const proOnly = await makeProduct(tx, by, { tier: 'professional' })

      /* D23 is a minimum tier. A broken link should fail when it is shared,
         not silently when somebody finally buys through it. */
      const message = await expectRejection(tx, () => click(tx, account.affiliate_code, proOnly))
      expect(message).toMatch(/may not promote/i)
    })
  })
})

describe.skipIf(!HAS_DB)('who gets the credit', () => {
  it('gives it to the last click inside the window', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const first = await makeAffiliate(tx, by, 'First Toucher')
      const last = await makeAffiliate(tx, by, 'Last Toucher')
      const buyer = await createUser(tx, { name: 'Buyer' })
      const product = await makeProduct(tx, by, { price: 20_000 })

      await click(tx, first.account.affiliate_code, product, { userId: buyer.id })
      await click(tx, last.account.affiliate_code, product, { userId: buyer.id })

      const order = await buy(tx, buyer.id, product)
      const conversion = await conversionFor(tx, order)
      expect(conversion?.affiliate_id).toBe(last.account.id)
    })
  })

  it('ignores a click older than the window', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const promoter = await makeAffiliate(tx, by, 'Too Early')
      const buyer = await createUser(tx, { name: 'Slow Buyer' })
      const product = await makeProduct(tx, by, { window: 720 })

      const clickId = await click(tx, promoter.account.affiliate_code, product, { userId: buyer.id })
      // 31 days ago, against a 30-day window.
      await tx.query(
        `update public.affiliate_clicks set created_at = now() - interval '31 days' where id = $1`,
        [clickId],
      )

      const order = await buy(tx, buyer.id, product)
      expect(await conversionFor(tx, order)).toBeNull()
    })
  })

  it('matches on the visitor cookie when the click was logged out', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const promoter = await makeAffiliate(tx, by, 'Cookie Promoter')
      const buyer = await createUser(tx, { name: 'Signed Up Later' })
      const product = await makeProduct(tx, by)
      const token = `visitor-${Date.now()}`

      /* The realistic path: somebody clicks a WhatsApp link, browses signed
         out, then creates an account to buy. Binding only to the user id would
         lose the credit for every one of those. */
      await click(tx, promoter.account.affiliate_code, product, { token })

      const order = await buy(tx, buyer.id, product, token)
      expect((await conversionFor(tx, order))?.affiliate_id).toBe(promoter.account.id)
    })
  })

  it('pays nobody for an organic sale', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const buyer = await createUser(tx, { name: 'Found It Themselves' })
      const product = await makeProduct(tx, by)
      const order = await buy(tx, buyer.id, product)
      expect(await conversionFor(tx, order)).toBeNull()
    })
  })

  it('pays nobody when an affiliate buys through their own link', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const promoter = await makeAffiliate(tx, by, 'Self Dealer')
      const product = await makeProduct(tx, by)

      await click(tx, promoter.account.affiliate_code, product, { userId: promoter.user.id })
      const order = await buy(tx, promoter.user.id, product)

      /* Given that training itself pays commission, buying your own entry fee
         through your own link would be a discount funded by the programme. */
      expect(await conversionFor(tx, order)).toBeNull()
    })
  })

  it('records the amount CHARGED as the base, not the list price', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const promoter = await makeAffiliate(tx, by, 'Sale Promoter')
      const buyer = await createUser(tx, { name: 'Sale Buyer' })
      const product = await makeProduct(tx, by, { price: 20_000 })
      await tx.query(`update public.products set sale_price_minor = 12000 where id = $1`, [product])

      await click(tx, promoter.account.affiliate_code, product, { userId: buyer.id })
      const order = await buy(tx, buyer.id, product)

      // Decided 2026-08-05. On the list price, a deep discount pays out more
      // commission than the sale brought in.
      expect(Number((await conversionFor(tx, order))!.base_minor)).toBe(12_000)
    })
  })

  it('makes one conversion per order, however many times the webhook retries', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const promoter = await makeAffiliate(tx, by, 'Retry Promoter')
      const buyer = await createUser(tx, { name: 'Retried Buyer' })
      const product = await makeProduct(tx, by)
      await click(tx, promoter.account.affiliate_code, product, { userId: buyer.id })

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_product_order($1, $2, 'paystack')`,
        [buyer.id, product],
      )
      const ref = `ATTR-RETRY-${Date.now()}`
      await tx.query(`select public.confirm_product_order($1, $2, null)`, [rows[0]!.id, ref])
      await tx.query(`select public.confirm_product_order($1, $2, null)`, [rows[0]!.id, ref])

      const { rows: count } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.conversions where order_id = $1`,
        [rows[0]!.id],
      )
      expect(Number(count[0]!.n)).toBe(1)
    })
  })
})

describe.skipIf(!HAS_DB)('level two, resolved at the moment of the sale', () => {
  /** Alpha recruits Beta: Beta buys training through Alpha's link. */
  const chain = async (tx: Tx, by: string, uplineLevel = 'professional') => {
    const alpha = await makeAffiliate(tx, by, `Alpha ${Date.now()}`, uplineLevel)
    const training = await makeTraining(tx, by, 'professional')
    const beta = await createUser(tx, { name: `Beta ${Date.now()}` })

    await click(tx, alpha.account.affiliate_code, training, { userId: beta.id })
    await buy(tx, beta.id, training)

    return { alpha, beta, betaAccount: (await accountOf(tx, beta.id))! }
  }

  it('freezes the upline on the recruited affiliate at creation', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { alpha, betaAccount } = await chain(tx, by)
      /* Attribution has to run BEFORE the account is created, or the
         recruitment relationship is lost — it is frozen at creation and there
         is no second chance to set it. */
      expect(betaAccount.parent_affiliate_id).toBe(alpha.account.id)
    })
  })

  it('pays an override when the upline holds Professional right now', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { alpha, betaAccount } = await chain(tx, by, 'professional')
      const customer = await createUser(tx, { name: 'Customer' })
      const product = await makeProduct(tx, by, { l1: 30, l2: 10 })

      await click(tx, betaAccount.affiliate_code, product, { userId: customer.id })
      const order = await buy(tx, customer.id, product)
      const conversion = await conversionFor(tx, order)

      expect(conversion?.affiliate_id).toBe(betaAccount.id)
      expect(conversion?.l2_affiliate_id).toBe(alpha.account.id)
      expect([Number(conversion?.l1_rate), Number(conversion?.l2_rate)]).toEqual([30, 10])
      expect(conversion?.l2_depth_at_conversion).toBe(2)
    })
  })

  it('pays no override when the upline only holds Beginner', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { betaAccount } = await chain(tx, by, 'beginner')
      const customer = await createUser(tx, { name: 'Customer Two' })
      const product = await makeProduct(tx, by)

      await click(tx, betaAccount.affiliate_code, product, { userId: customer.id })
      const order = await buy(tx, customer.id, product)
      const conversion = await conversionFor(tx, order)

      /* Beginner unlocks one level. The relationship still exists — the
         override simply is not payable, and the depth is written down so the
         answer survives. */
      expect(conversion?.l2_affiliate_id).toBeNull()
      expect(conversion?.l2_depth_at_conversion).toBe(1)
    })
  })

  it('pays no override once the upline has lapsed', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { alpha, betaAccount } = await chain(tx, by, 'professional')
      const customer = await createUser(tx, { name: 'Customer Three' })
      const product = await makeProduct(tx, by)

      /* C22 doing the work it was chosen for. With a one-year entitlement this
         fires routinely rather than only on suspension — and it is what makes
         the year mean something. */
      await tx.query(
        `update public.affiliate_entitlements
            set starts_at = now() - interval '400 days',
                expires_at = now() - interval '10 days',
                grace_ends_at = now() - interval '5 days'
          where affiliate_id = $1`,
        [alpha.account.id],
      )

      await click(tx, betaAccount.affiliate_code, product, { userId: customer.id })
      const order = await buy(tx, customer.id, product)
      const conversion = await conversionFor(tx, order)

      expect(conversion?.l2_affiliate_id).toBeNull()
      expect(conversion?.l2_depth_at_conversion).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('what never pays', () => {
  it('a renewal pays nobody, at any level', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const promoter = await makeAffiliate(tx, by, 'Renewal Promoter')
      const buyer = await createUser(tx, { name: 'Renewer' })
      const training = await makeTraining(tx, by)

      await click(tx, promoter.account.affiliate_code, training, { userId: buyer.id })

      const { rows } = await tx.query<{ id: string }>(
        `insert into public.orders (user_id, product_id, kind, amount_minor, list_price_minor, method, status)
         values ($1, $2, 'training_renewal', 25000, 40000, 'paystack', 'pending') returning id`,
        [buyer.id, training],
      )
      await tx.query(`select public.confirm_product_order($1, $2, null)`, [
        rows[0]!.id,
        `RENEW-${Date.now()}`,
      ])

      /* B11c. An override paid every year for a single recruitment is
         residual recruitment income — the least defensible shape in the whole
         design, and the reason a renewal leaves the attribution function
         before anything is written. */
      expect(await conversionFor(tx, rows[0]!.id)).toBeNull()
    })
  })

  it('a product with no programme pays nobody', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const promoter = await makeAffiliate(tx, by, 'No Programme')
      const buyer = await createUser(tx, { name: 'Plain Buyer' })
      seq += 1
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
         values ('course', 'vendor_product', 'Unprogrammed', $1, 9000, 'published', $2) returning id`,
        [`noprog-${Date.now()}-${seq}`, by],
      )

      /* No affiliate_programs row. The link is refused when it is SHARED
         rather than silently paying nothing when somebody buys — which is
         what migration 113 added after this test found the gap. */
      const message = await expectRejection(tx, () =>
        click(tx, promoter.account.affiliate_code, rows[0]!.id),
      )
      expect(message).toMatch(/does not pay commission/i)

      const order = await buy(tx, buyer.id, rows[0]!.id)
      expect(await conversionFor(tx, order)).toBeNull()
    })
  })
})

describe.skipIf(!HAS_DB)('the two rates together', () => {
  it('cannot be configured to pay out more than the sale', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      seq += 1
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
         values ('course', 'vendor_product', 'Greedy', $1, 10000, 'published', $2) returning id`,
        [`greedy-${Date.now()}-${seq}`, by],
      )
      /* Refused at configuration rather than clamped at payment. A clamp hides
         the mistake until somebody reads a report; a rate pair paying 120% of
         a sale is never a promotion. */
      const message = await expectRejection(tx, () =>
        tx.query(
          `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value)
           values ($1, 80, 40)`,
          [rows[0]!.id],
        ),
      )
      expect(message).toMatch(/affiliate_programs_together_sane/i)
    })
  })
})

/**
 * Migration 176. The bug these cover was reported by the operator on
 * 2026-08-11: an admin invited somebody with a referral code, that person
 * recruited a buyer, the buyer bought training, and only the middle affiliate
 * was paid.
 *
 * The platform had two referral trees. Phase 1 wrote the invitation into
 * `referrals`; Phase 2 only ever wrote an upline from a click-attributed
 * training sale, so an invitation recorded nothing the commission code could
 * see and the second level had nobody to pay.
 */
describe.skipIf(!HAS_DB)('an invitation is an upline too', () => {
  const invite = async (tx: Tx, referrerId: string, refereeId: string) => {
    const { rows } = await tx.query<{ referral_code: string }>(
      `select referral_code from public.profiles where id = $1`,
      [referrerId],
    )
    await tx.query(`select public.apply_referral_code($1, $2)`, [refereeId, rows[0]!.referral_code])
  }

  const creditsFor = async (tx: Tx, conversionId: string) => {
    const { rows } = await tx.query<{ level: number; affiliate_id: string; amount_minor: string }>(
      `select level, affiliate_id, amount_minor::text
         from public.commission_ledger
        where conversion_id = $1 and entry_type = 'credit'
        order by level`,
      [conversionId],
    )
    return rows
  }

  const conversionIdFor = async (tx: Tx, orderId: string) => {
    const { rows } = await tx.query<{ id: string }>(
      `select id from public.conversions where order_id = $1`,
      [orderId],
    )
    return rows[0]!.id
  }

  it('records the referrer as the upline when no link sold the training', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const inviter = await makeAffiliate(tx, by, 'Inviter')
      const recruit = await createUser(tx, { name: 'Invited' })

      /* The whole shape of the bug: an invitation, and no click anywhere. */
      await invite(tx, inviter.user.id, recruit.id)
      await buy(tx, recruit.id, await makeTraining(tx, by, 'beginner'))

      expect((await accountOf(tx, recruit.id))!.parent_affiliate_id).toBe(inviter.account.id)
    })
  })

  it('pays that upline level two when the recruit makes a sale', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const inviter = await makeAffiliate(tx, by, 'Paid Inviter')
      const recruitUser = await createUser(tx, { name: 'Paid Recruit' })

      await invite(tx, inviter.user.id, recruitUser.id)
      await buy(tx, recruitUser.id, await makeTraining(tx, by, 'beginner'))
      const recruit = (await accountOf(tx, recruitUser.id))!

      const customer = await createUser(tx, { name: 'Their Customer' })
      const product = await makeProduct(tx, by, { price: 15_000, l1: 20, l2: 5 })
      await click(tx, recruit.affiliate_code, product, { userId: customer.id })
      const order = await buy(tx, customer.id, product)

      /* The money, not just the relationship. Asserting the conversion row
         alone would have passed on the live data too, one field earlier than
         the fault. */
      const credits = await creditsFor(tx, await conversionIdFor(tx, order))
      expect(credits.map((c) => [c.level, c.affiliate_id, c.amount_minor])).toEqual([
        [1, recruit.id, '3000'],
        [2, inviter.account.id, '750'],
      ])
    })
  })

  it('lets the click outrank the invitation, because a sale is more specific', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const inviter = await makeAffiliate(tx, by, 'Merely Invited By')
      const seller = await makeAffiliate(tx, by, 'Actually Sold It')
      const recruit = await createUser(tx, { name: 'Bought Elsewhere' })

      await invite(tx, inviter.user.id, recruit.id)
      const training = await makeTraining(tx, by, 'beginner')
      await click(tx, seller.account.affiliate_code, training, { userId: recruit.id })
      await buy(tx, recruit.id, training)

      expect((await accountOf(tx, recruit.id))!.parent_affiliate_id).toBe(seller.account.id)
    })
  })

  it('leaves an organic buyer with no upline at all', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const alone = await createUser(tx, { name: 'Nobody Sent Me' })
      await buy(tx, alone.id, await makeTraining(tx, by, 'beginner'))

      /* Null is the right answer, not a gap to be filled later. Nobody
         recruited them. */
      expect((await accountOf(tx, alone.id))!.parent_affiliate_id).toBeNull()
    })
  })

  it('refuses to move an upline once one is recorded', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const first = await makeAffiliate(tx, by, 'First Upline')
      const other = await makeAffiliate(tx, by, 'Somebody Else')
      const recruit = await createUser(tx, { name: 'Contested' })

      await invite(tx, first.user.id, recruit.id)
      await buy(tx, recruit.id, await makeTraining(tx, by, 'beginner'))
      const account = (await accountOf(tx, recruit.id))!

      /* Moving an upline silently redirects every future override and this
         table keeps no audit trail. Filling a null is still allowed, which is
         how migration 176 repaired the accounts that predate it. */
      const message = await expectRejection(tx, () =>
        tx.query(`update public.affiliate_accounts set parent_affiliate_id = $1 where id = $2`, [
          other.account.id,
          account.id,
        ]),
      )
      expect(message).toMatch(/recorded once/i)
    })
  })
})
