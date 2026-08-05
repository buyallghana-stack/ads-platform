import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Renewing training, and upgrading Beginner to Professional.
 *
 * Three operator decisions are what these tests exist to hold in place, and
 * each one is a place money or a right could go astray:
 *
 *  - a renewal PAYS NOBODY, at any level (B11c). Paying an override every year
 *    for a single recruitment is residual recruitment income.
 *  - a renewal extends from the LATER of the current expiry and today, so
 *    renewing early does not cost the days already paid for.
 *  - an upgrade pays the UPLINE, not the last click — otherwise somebody could
 *    open a friend's link and move their own upgrade commission.
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

const makeTraining = async (
  tx: Tx,
  by: string,
  o: { level?: string; price?: number; renewal?: number | null; validity?: number; grace?: number } = {},
) => {
  const { level = 'beginner', price = 15_000, renewal = 10_000, validity = 365, grace = 5 } = o
  const depth = level === 'professional' ? 2 : 1
  seq += 1
  const { rows: prod } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'training_program', $1, $2, $3, 'published', $4) returning id`,
    [`Training ${level}`, `ru-${Date.now()}-${seq}`, price, by],
  )
  const productId = prod[0]!.id
  await tx.query(
    `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value)
     values ($1, 20, 5)`,
    [productId],
  )
  const { rows: tp } = await tx.query<{ id: string }>(
    `insert into public.training_programs
       (product_id, level, commission_depth, activation_threshold_percent,
        quiz_required, validity_days, grace_days, renewal_price_minor)
     values ($1, $2::public.affiliate_tier, $3, 0, false, $4, $5, $6) returning id`,
    [productId, level, depth, validity, grace, renewal],
  )
  return { productId, programId: tp[0]!.id }
}

const buy = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.start_product_order($1, $2, 'paystack')`,
    [userId, productId],
  )
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2, null)`, [
    rows[0]!.id,
    `RU-${Date.now()}-${seq}`,
  ])
  return rows[0]!.id
}

const confirm = async (tx: Tx, orderId: string) => {
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2, null)`, [
    orderId,
    `RU-${Date.now()}-${seq}`,
  ])
}

const accountOf = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ id: string; affiliate_code: string }>(
    `select id, affiliate_code from public.affiliate_accounts where user_id = $1`,
    [userId],
  )
  return rows[0]!
}

const depthOf = async (tx: Tx, affiliateId: string) => {
  const { rows } = await tx.query<{ d: number }>(`select public.affiliate_depth_now($1) as d`, [
    affiliateId,
  ])
  return rows[0]!.d
}

const balance = async (tx: Tx, affiliateId: string) => {
  const { rows } = await tx.query<{ b: string }>(
    `select public.affiliate_balance_minor($1)::text as b`,
    [affiliateId],
  )
  return Number(rows[0]!.b)
}

const click = async (tx: Tx, code: string, productId: string, userId: string) => {
  await tx.query(`select public.record_affiliate_click($1, $2, null, null, $3)`, [
    code,
    productId,
    userId,
  ])
}

describe.skipIf(!HAS_DB)('renewing', () => {
  it('charges the renewal price, not the full one', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Renewer' })
      const { productId, programId } = await makeTraining(tx, by, { price: 15_000, renewal: 10_000 })
      await buy(tx, user.id, productId)

      const { rows } = await tx.query<{ amount_minor: string; list_price_minor: string }>(
        `select amount_minor::text, list_price_minor::text
           from public.start_training_renewal($1, $2, 'paystack')`,
        [user.id, programId],
      )
      expect([Number(rows[0]!.amount_minor), Number(rows[0]!.list_price_minor)]).toEqual([
        10_000, 15_000,
      ])
    })
  })

  it('extends from the current expiry, so renewing early loses nothing', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Early Renewer' })
      const { productId, programId } = await makeTraining(tx, by, { validity: 365, grace: 5 })
      await buy(tx, user.id, productId)
      const account = await accountOf(tx, user.id)

      const before = await tx
        .query<{ e: string }>(
          `select expires_at::text as e from public.affiliate_entitlements where affiliate_id = $1`,
          [account.id],
        )
        .then((r) => new Date(r.rows[0]!.e).getTime())

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_training_renewal($1, $2, 'paystack')`,
        [user.id, programId],
      )
      await confirm(tx, rows[0]!.id)

      const after = await tx
        .query<{ e: string }>(
          `select expires_at::text as e from public.affiliate_entitlements where affiliate_id = $1`,
          [account.id],
        )
        .then((r) => new Date(r.rows[0]!.e).getTime())

      /* A second year on top of the first, not a year from today. Always from
         today would quietly punish whoever renews on time. */
      const days = Math.round((after - before) / 86_400_000)
      expect(days).toBe(365)
    })
  })

  it('extends from TODAY once it has already lapsed', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Late Renewer' })
      const { productId, programId } = await makeTraining(tx, by, { validity: 365 })
      await buy(tx, user.id, productId)
      const account = await accountOf(tx, user.id)

      await tx.query(
        `update public.affiliate_entitlements
            set starts_at = now() - interval '400 days',
                expires_at = now() - interval '35 days',
                grace_ends_at = now() - interval '30 days'
          where affiliate_id = $1`,
        [account.id],
      )
      expect(await depthOf(tx, account.id)).toBe(0)

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_training_renewal($1, $2, 'paystack')`,
        [user.id, programId],
      )
      await confirm(tx, rows[0]!.id)

      // Backdating a full year from a long-lapsed expiry would sell them a
      // year already spent.
      const days = await tx
        .query<{ d: number }>(
          `select round(extract(epoch from (expires_at - now())) / 86400)::int as d
             from public.affiliate_entitlements where affiliate_id = $1`,
          [account.id],
        )
        .then((r) => r.rows[0]!.d)
      expect(days).toBe(365)
      expect(await depthOf(tx, account.id)).toBe(1)
    })
  })

  it('pays nobody, at any level', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const upline = await createUser(tx, { name: 'Renewal Upline' })
      const pro = await makeTraining(tx, by, { level: 'professional', price: 40_000 })
      await buy(tx, upline.id, pro.productId)
      const uplineAccount = await accountOf(tx, upline.id)

      const user = await createUser(tx, { name: 'Their Recruit' })
      const beginner = await makeTraining(tx, by, { price: 15_000, renewal: 10_000 })
      await click(tx, uplineAccount.affiliate_code, beginner.productId, user.id)
      await buy(tx, user.id, beginner.productId)

      const earnedOnTheSale = await balance(tx, uplineAccount.id)
      expect(earnedOnTheSale).toBeGreaterThan(0)

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_training_renewal($1, $2, 'paystack')`,
        [user.id, beginner.programId],
      )
      await confirm(tx, rows[0]!.id)

      /* B11c. An override paid every year for a single recruitment is
         residual recruitment income — the least defensible shape in this
         design, and the renewal leaves attribution before anything is
         written. */
      expect(await balance(tx, uplineAccount.id)).toBe(earnedOnTheSale)
      const { rows: conv } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.conversions where order_id = $1`,
        [rows[0]!.id],
      )
      expect(Number(conv[0]!.n)).toBe(0)
    })
  })

  it('refuses to renew training nobody bought', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Never Bought' })
      const { programId } = await makeTraining(tx, by)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.start_training_renewal($1, $2, 'paystack')`, [user.id, programId]),
      )
      expect(message).toMatch(/not bought this training/i)
    })
  })
})

describe.skipIf(!HAS_DB)('upgrading', () => {
  it('charges the difference between what they paid and the new price', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Upgrader' })
      const beginner = await makeTraining(tx, by, { price: 15_000 })
      const pro = await makeTraining(tx, by, { level: 'professional', price: 40_000 })
      await buy(tx, user.id, beginner.productId)

      const { rows } = await tx.query<{ amount_minor: string; list_price_minor: string }>(
        `select amount_minor::text, list_price_minor::text
           from public.start_training_upgrade($1, $2, 'paystack')`,
        [user.id, pro.programId],
      )
      // GHS 400 − GHS 150 = GHS 250.
      expect([Number(rows[0]!.amount_minor), Number(rows[0]!.list_price_minor)]).toEqual([
        25_000, 40_000,
      ])
    })
  })

  it('credits what they ACTUALLY PAID, not the current list price', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Bought On Sale' })
      const beginner = await makeTraining(tx, by, { price: 15_000 })
      const pro = await makeTraining(tx, by, { level: 'professional', price: 40_000 })

      // Bought at a sale price of GHS 100.
      await tx.query(`update public.products set sale_price_minor = 10000 where id = $1`, [
        beginner.productId,
      ])
      await buy(tx, user.id, beginner.productId)
      // …and the sale ends.
      await tx.query(`update public.products set sale_price_minor = null where id = $1`, [
        beginner.productId,
      ])

      const { rows } = await tx.query<{ amount_minor: string }>(
        `select amount_minor::text from public.start_training_upgrade($1, $2, 'paystack')`,
        [user.id, pro.programId],
      )
      /* 40,000 − 10,000 = 30,000. Crediting the list price would hand them
         GHS 50 they never spent, and would drift every time the Owner
         re-prices. */
      expect(Number(rows[0]!.amount_minor)).toBe(30_000)
    })
  })

  it('raises the affiliate to two levels', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Going Pro' })
      const beginner = await makeTraining(tx, by, { price: 15_000 })
      const pro = await makeTraining(tx, by, { level: 'professional', price: 40_000 })
      await buy(tx, user.id, beginner.productId)
      const account = await accountOf(tx, user.id)
      expect(await depthOf(tx, account.id)).toBe(1)

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_training_upgrade($1, $2, 'paystack')`,
        [user.id, pro.programId],
      )
      await confirm(tx, rows[0]!.id)

      /* No new machinery: a second entitlement sits beside the first and
         `affiliate_depth_now` takes the maximum. */
      expect(await depthOf(tx, account.id)).toBe(2)

      const { rows: owns } = await tx.query<{ ok: boolean }>(
        `select public.has_entitlement($1, $2) as ok`,
        [user.id, pro.productId],
      )
      expect(owns[0]!.ok).toBe(true)
    })
  })

  it('pays the UPLINE, not whoever they last clicked', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)

      const recruiter = await createUser(tx, { name: 'Their Recruiter' })
      const proProgram = await makeTraining(tx, by, { level: 'professional', price: 40_000 })
      await buy(tx, recruiter.id, proProgram.productId)
      const recruiterAccount = await accountOf(tx, recruiter.id)

      const stranger = await createUser(tx, { name: 'Opportunist' })
      const anotherPro = await makeTraining(tx, by, { level: 'professional', price: 40_000 })
      await buy(tx, stranger.id, anotherPro.productId)
      const strangerAccount = await accountOf(tx, stranger.id)

      // Recruited into Beginner by the recruiter.
      const beginner = await makeTraining(tx, by, { price: 15_000 })
      const user = await createUser(tx, { name: 'The Upgrader' })
      await click(tx, recruiterAccount.affiliate_code, beginner.productId, user.id)
      await buy(tx, user.id, beginner.productId)

      const recruiterBefore = await balance(tx, recruiterAccount.id)
      const strangerBefore = await balance(tx, strangerAccount.id)

      /* Now they click a STRANGER's link for the Professional product before
         upgrading. Under last-click that stranger would take the commission on
         a customer they never brought in. */
      await click(tx, strangerAccount.affiliate_code, proProgram.productId, user.id)

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_training_upgrade($1, $2, 'paystack')`,
        [user.id, proProgram.programId],
      )
      await confirm(tx, rows[0]!.id)

      // 20% of the GHS 250 difference = GHS 50, to the recruiter — level one
      // off the amount charged, which for an upgrade IS the difference.
      expect((await balance(tx, recruiterAccount.id)) - recruiterBefore).toBe(5_000)
      expect(await balance(tx, strangerAccount.id)).toBe(strangerBefore)
    })
  })

  it('pays on the difference, not on the full price', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const recruiter = await createUser(tx, { name: 'Difference Recruiter' })
      const proProgram = await makeTraining(tx, by, { level: 'professional', price: 40_000 })
      await buy(tx, recruiter.id, proProgram.productId)
      const recruiterAccount = await accountOf(tx, recruiter.id)

      const beginner = await makeTraining(tx, by, { price: 15_000 })
      const user = await createUser(tx, { name: 'Difference Upgrader' })
      await click(tx, recruiterAccount.affiliate_code, beginner.productId, user.id)
      await buy(tx, user.id, beginner.productId)
      const before = await balance(tx, recruiterAccount.id)

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_training_upgrade($1, $2, 'paystack')`,
        [user.id, proProgram.programId],
      )
      await confirm(tx, rows[0]!.id)

      const { rows: conv } = await tx.query<{ base_minor: string }>(
        `select base_minor::text from public.conversions where order_id = $1`,
        [rows[0]!.id],
      )
      // The base is the amount charged (GHS 250), not the GHS 400 list price.
      expect(Number(conv[0]!.base_minor)).toBe(25_000)
      expect((await balance(tx, recruiterAccount.id)) - before).toBe(5_000)
    })
  })

  it('pays nobody when they were never recruited', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Organic Upgrader' })
      const beginner = await makeTraining(tx, by, { price: 15_000 })
      const pro = await makeTraining(tx, by, { level: 'professional', price: 40_000 })
      await buy(tx, user.id, beginner.productId)   // no click: organic

      const { rows } = await tx.query<{ id: string }>(
        `select id from public.start_training_upgrade($1, $2, 'paystack')`,
        [user.id, pro.programId],
      )
      await confirm(tx, rows[0]!.id)

      const { rows: conv } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.conversions where order_id = $1`,
        [rows[0]!.id],
      )
      expect(Number(conv[0]!.n)).toBe(0)
    })
  })

  it('refuses an upgrade from nothing, and a sideways one', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const nobody = await createUser(tx, { name: 'Holds Nothing' })
      const pro = await makeTraining(tx, by, { level: 'professional', price: 40_000 })

      const fromNothing = await expectRejection(tx, () =>
        tx.query(`select public.start_training_upgrade($1, $2, 'paystack')`, [
          nobody.id,
          pro.programId,
        ]),
      )
      expect(fromNothing).toMatch(/no training to upgrade from/i)

      const already = await createUser(tx, { name: 'Already Pro' })
      await buy(tx, already.id, pro.productId)
      const sideways = await expectRejection(tx, () =>
        tx.query(`select public.start_training_upgrade($1, $2, 'paystack')`, [
          already.id,
          pro.programId,
        ]),
      )
      expect(sideways).toMatch(/already hold that training or better/i)
    })
  })
})
