import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Affiliate Ops: the affiliates list, the conversions browser, the commission
 * queue, and suspension.
 *
 * The conversions browser is the one that earns its keep. It exists to answer
 * "why was I not paid for that sale?", which is the argument an affiliate
 * programme reliably produces and the one that cannot be settled afterwards
 * unless the answer was written down at the time. So the tests care most about
 * whether the reason is legible — a click, or the upline rule that governs an
 * upgrade — rather than about the row counts.
 */

const superAdmin = async (tx: Tx) => {
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
     values ('course', $1::public.product_purpose, 'Ops Product', $2, $3, 'published', $4)
     returning id`,
    [purpose, `ops-${Date.now()}-${seq}`, price, by],
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
    `OPS-${Date.now()}-${seq}`,
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

const click = async (tx: Tx, code: string, productId: string, userId: string, subid?: string) => {
  await tx.query(`select public.record_affiliate_click($1, $2, $3, null, $4)`, [
    code,
    productId,
    subid ?? null,
    userId,
  ])
}

/** One affiliate with a sale behind them. */
const seller = async (tx: Tx, by: string, name: string) => {
  const user = await createUser(tx, { name })
  await buy(tx, user.id, await makeTraining(tx, by))
  return { user, account: await accountOf(tx, user.id) }
}

const listAffiliates = async (tx: Tx, scope = 'all') => {
  const { rows } = await tx.query<Record<string, unknown>>(
    `select * from public.admin_list_affiliates($1)`,
    [scope],
  )
  return rows
}

describe.skipIf(!HAS_DB)('the affiliates list', () => {
  it('shows who they are, what they hold and what they are owed', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const promoter = await seller(tx, by, 'Listed Promoter')
      const buyer = await createUser(tx, { name: 'A Customer' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      await click(tx, promoter.account.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      const rows = await listAffiliates(tx)
      const mine = rows.find((r) => r.affiliate_id === promoter.account.id)!

      expect(mine.status).toBe('active')
      expect(mine.tier).toBe('professional')
      expect(mine.depth_now).toBe(2)
      expect(Number(mine.conversions)).toBe(1)
      expect(Number(mine.clicks)).toBe(1)
      // 30% of GHS 200 on the vendor sale, plus what they earned on training.
      expect(Number(mine.balance_minor)).toBeGreaterThanOrEqual(6_000)
    })
  })

  it('reports the end of GRACE as when promotion stops, not the term', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const promoter = await seller(tx, by, 'Grace Holder')

      const { rows } = await tx.query<{ g: string }>(
        `select grace_ends_at::text as g from public.affiliate_entitlements
          where affiliate_id = $1`,
        [promoter.account.id],
      )
      const listed = (await listAffiliates(tx)).find(
        (r) => r.affiliate_id === promoter.account.id,
      )!

      /* B11e: they can still earn during grace, so the date that matters to
         support is when grace ends — not when the term did. */
      expect(new Date(listed.promotion_ends as string).getTime()).toBe(
        new Date(rows[0]!.g).getTime(),
      )
    })
  })

  it('finds the lapsed by asking, since lapsed is not a status', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const promoter = await seller(tx, by, 'Lapsing Promoter')

      expect((await listAffiliates(tx, 'lapsed')).some((r) => r.affiliate_id === promoter.account.id))
        .toBe(false)

      await tx.query(
        `update public.affiliate_entitlements
            set starts_at = now() - interval '400 days',
                expires_at = now() - interval '10 days',
                grace_ends_at = now() - interval '5 days'
          where affiliate_id = $1`,
        [promoter.account.id],
      )

      /* "Lapsed" is a date that has passed, not a column somebody remembered
         to update — which is why it is computed live and can never be stale. */
      const lapsed = await listAffiliates(tx, 'lapsed')
      const mine = lapsed.find((r) => r.affiliate_id === promoter.account.id)
      expect(mine).toBeDefined()
      expect(mine!.depth_now).toBe(0)
      expect(mine!.status).toBe('active')
    })
  })

  it('names the upline', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const recruiter = await seller(tx, by, 'The Recruiter')
      const training = await makeTraining(tx, by)
      const recruit = await createUser(tx, { name: 'The Recruit' })
      await click(tx, recruiter.account.affiliate_code, training, recruit.id)
      await buy(tx, recruit.id, training)

      const recruitAccount = await accountOf(tx, recruit.id)
      const listed = (await listAffiliates(tx)).find(
        (r) => r.affiliate_id === recruitAccount.id,
      )!
      expect(listed.upline_name).toBe('The Recruiter')
    })
  })
})

describe.skipIf(!HAS_DB)('the conversions browser', () => {
  it('says WHY the commission went where it did, for a tracked click', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const promoter = await seller(tx, by, 'Click Seller')
      const buyer = await createUser(tx, { name: 'Click Buyer' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30, l2: 10 })
      await click(tx, promoter.account.affiliate_code, product, buyer.id, 'whatsapp-status')
      const order = await buy(tx, buyer.id, product)

      const { rows } = await tx.query<Record<string, unknown>>(
        `select * from public.admin_list_conversions(now() - interval '1 day', now() + interval '1 day')`,
      )
      const mine = rows.find((r) => r.order_id === order)!

      expect(mine.attributed_by).toBe('click')
      expect(mine.subid).toBe('whatsapp-status')
      expect(mine.clicked_at).not.toBeNull()
      expect(Number(mine.l1_minor)).toBe(6_000)
      expect(Number(mine.base_minor)).toBe(20_000)
    })
  })

  it('says so when an upgrade paid the upline instead of a click', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const recruiter = await seller(tx, by, 'Upgrade Recruiter')

      const beginnerProduct = await makeTraining(tx, by, 'beginner')
      const user = await createUser(tx, { name: 'Upgrading User' })
      await click(tx, recruiter.account.affiliate_code, beginnerProduct, user.id)
      await buy(tx, user.id, beginnerProduct)

      const proProduct = await makeTraining(tx, by, 'professional')
      const { rows: pro } = await tx.query<{ id: string }>(
        `select id from public.training_programs where product_id = $1`,
        [proProduct],
      )
      const { rows: order } = await tx.query<{ id: string }>(
        `select id from public.start_training_upgrade($1, $2, 'paystack')`,
        [user.id, pro[0]!.id],
      )
      seq += 1
      await tx.query(`select public.confirm_product_order($1, $2, null)`, [
        order[0]!.id,
        `OPSU-${Date.now()}-${seq}`,
      ])

      const { rows } = await tx.query<Record<string, unknown>>(
        `select * from public.admin_list_conversions(now() - interval '1 day', now() + interval '1 day')`,
      )
      const mine = rows.find((r) => r.order_id === order[0]!.id)!

      /* An upgrade has no click at all (B8). Without this column a support
         agent looking at a conversion with a null click_id would have nothing
         to tell the affiliate who asks why. */
      expect(mine.attributed_by).toBe('upline (upgrade)')
      expect(mine.order_kind).toBe('training_upgrade')
      expect(mine.clicked_at).toBeNull()
    })
  })

  it('shows a conversion to the upline as well as to the seller', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const upline = await seller(tx, by, 'The Upline')
      const training = await makeTraining(tx, by)
      const middle = await createUser(tx, { name: 'The Middle' })
      await click(tx, upline.account.affiliate_code, training, middle.id)
      await buy(tx, middle.id, training)
      const middleAccount = await accountOf(tx, middle.id)

      const buyer = await createUser(tx, { name: 'End Buyer' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30, l2: 10 })
      await click(tx, middleAccount.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)

      // Filtered by the UPLINE: they need to see the sale they earned an
      // override on, not only the ones they made themselves.
      const { rows } = await tx.query<Record<string, unknown>>(
        `select * from public.admin_list_conversions(now() - interval '1 day', now() + interval '1 day', $1)`,
        [upline.account.id],
      )
      const mine = rows.find((r) => r.order_id === order)!
      expect(mine.l2_affiliate_name).toBe('The Upline')
      expect(Number(mine.l2_minor)).toBe(2_000)
      expect(mine.l2_depth_at_conversion).toBe(2)
    })
  })
})

describe.skipIf(!HAS_DB)('the commission queue', () => {
  it('shows reversals and payouts, not only credits', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const promoter = await seller(tx, by, 'Queue Seller')
      const buyer = await createUser(tx, { name: 'Queue Buyer' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      await click(tx, promoter.account.affiliate_code, product, buyer.id)
      const order = await buy(tx, buyer.id, product)
      await tx.query(`select public.refund_product_order($1, $2, 'returned')`, [order, by])

      const { rows } = await tx.query<{ entry_type: string }>(
        `select entry_type from public.admin_list_commissions(null, $1)`,
        [promoter.account.id],
      )
      /* A queue that shows only credits cannot explain why somebody's balance
         went down, which is the question it will be opened to answer. */
      expect(rows.map((r) => r.entry_type)).toContain('reversal')
      expect(rows.map((r) => r.entry_type)).toContain('credit')
    })
  })

  it('does not net a negative balance against what others are owed', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)

      const owed = await seller(tx, by, 'Is Owed')
      const buyer1 = await createUser(tx, { name: 'Buyer One' })
      const product1 = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      await click(tx, owed.account.affiliate_code, product1, buyer1.id)
      await buy(tx, buyer1.id, product1)

      const negative = await seller(tx, by, 'Owes Us')
      const buyer2 = await createUser(tx, { name: 'Buyer Two' })
      const product2 = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      await click(tx, negative.account.affiliate_code, product2, buyer2.id)
      const refunded = await buy(tx, buyer2.id, product2)
      await tx.query(
        `insert into public.commission_ledger
           (affiliate_id, entry_type, amount_minor, status, idempotency_key)
         values ($1, 'payout', -6000, 'paid', $2)`,
        [negative.account.id, `ops-payout-${Date.now()}`],
      )
      await tx.query(`select public.refund_product_order($1, $2, 'chargeback')`, [refunded, by])

      const { rows } = await tx.query<{ owed_minor: string; affiliates_owed: number }>(
        `select owed_minor::text, affiliates_owed
           from public.admin_commission_totals(now() - interval '1 day', now() + interval '1 day')`,
      )

      /* C21 lets a balance go negative after a post-payout reversal. Netting
         that against somebody else's credit would understate what is actually
         owed to the people who are owed — and that figure is what the Owner
         budgets against. */
      const negativeBalance = await tx
        .query<{ b: string }>(`select public.affiliate_balance_minor($1)::text as b`, [
          negative.account.id,
        ])
        .then((r) => Number(r.rows[0]!.b))
      expect(negativeBalance).toBeLessThan(0)
      expect(Number(rows[0]!.owed_minor)).toBeGreaterThan(0)
    })
  })
})

describe.skipIf(!HAS_DB)('suspending an affiliate', () => {
  it('stops them earning immediately, without touching what they already earned', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const promoter = await seller(tx, by, 'To Suspend')
      const buyer = await createUser(tx, { name: 'Before Suspension' })
      const product = await makeProduct(tx, by, { price: 20_000, l1: 30 })
      await click(tx, promoter.account.affiliate_code, product, buyer.id)
      await buy(tx, buyer.id, product)

      const earned = await tx
        .query<{ b: string }>(`select public.affiliate_balance_minor($1)::text as b`, [
          promoter.account.id,
        ])
        .then((r) => Number(r.rows[0]!.b))

      await tx.query(
        `select public.admin_set_affiliate_status($1, $2, 'suspended', 'mostly recruiting')`,
        [by, promoter.account.id],
      )

      /* Earning stops because `affiliate_depth_now` requires an ACTIVE
         account. Money already earned is untouched — clawing that back is a
         separate, deliberate act with its own reason, not a side effect of a
         status change. */
      const depth = await tx
        .query<{ d: number }>(`select public.affiliate_depth_now($1) as d`, [promoter.account.id])
        .then((r) => r.rows[0]!.d)
      expect(depth).toBe(0)

      const after = await tx
        .query<{ b: string }>(`select public.affiliate_balance_minor($1)::text as b`, [
          promoter.account.id,
        ])
        .then((r) => Number(r.rows[0]!.b))
      expect(after).toBe(earned)
    })
  })

  it('refuses a suspension with no reason', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const promoter = await seller(tx, by, 'No Reason Given')

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_set_affiliate_status($1, $2, 'suspended', '  ')`, [
          by,
          promoter.account.id,
        ]),
      )
      expect(message).toMatch(/needs a reason/i)
    })
  })

  it('writes the change to the audit trail with its reason', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const promoter = await seller(tx, by, 'Audited Suspension')

      await tx.query(
        `select public.admin_set_affiliate_status($1, $2, 'suspended', 'farming referrals')`,
        [by, promoter.account.id],
      )

      /* Filtered by ACTION as well as entity. `evaluate_affiliate_activation`
         also audits against ('affiliate_accounts', this id) when the account
         switches on, so entity_id alone is not a unique key in the trail —
         without the action filter this asserts against whichever row came
         back first. */
      const { rows } = await tx.query<{ reason: string; status: string }>(
        `select new_values->>'reason' as reason, new_values->>'status' as status
           from public.admin_audit_log
          where entity_type = 'affiliate_accounts'
            and entity_id = $1
            and action = 'update'
          order by created_at desc
          limit 1`,
        [promoter.account.id],
      )
      expect([rows[0]!.status, rows[0]!.reason]).toEqual(['suspended', 'farming referrals'])
    })
  })

  it('reinstates somebody who never activated back to PENDING, not active', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Never Finished' })
      await tx.query(
        `insert into public.affiliate_accounts (user_id, affiliate_code, status)
         values ($1, public.generate_affiliate_code(), 'pending')`,
        [user.id],
      )
      const account = await accountOf(tx, user.id)

      await tx.query(`select public.admin_set_affiliate_status($1, $2, 'suspended', 'checking')`, [
        by,
        account.id,
      ])
      await tx.query(`select public.admin_set_affiliate_status($1, $2, 'active', null)`, [
        by,
        account.id,
      ])

      /* Sending them straight to active would hand out the right to earn that
         the completion threshold exists to gate. */
      const { rows } = await tx.query<{ status: string }>(
        `select status::text from public.affiliate_accounts where id = $1`,
        [account.id],
      )
      expect(rows[0]!.status).toBe('pending')
    })
  })
})
