import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  PINNED_LADDER,
  type Tx,
  createAdmin,
  createUser,
  expectRejection,
  pinLadder,
  withRollback,
} from '../support/db'

/**
 * A plan announced before it is sold.
 *
 * The operator wanted the rungs above Gold visible but not buyable: the ladder
 * reads as complete, the top of it reads as coming, and nobody is charged for
 * one. The card shows a locked button, and a locked button is a picture of a
 * rule rather than the rule, so what is pinned here is the database.
 *
 * ⚠️ THE TRAP THIS FILE EXISTS FOR. The obvious way to build this is
 * `is_active = false`, and it is wrong in a way that costs money quietly.
 * Every band is cut against the NEXT rung up: Gold's ceiling is one pesewa
 * under Platinum's price, and the rate Gold interpolates towards is Platinum's
 * multiplier. Take Platinum out of the ladder and Gold silently starts selling
 * a different band at a different rate, with nothing raised anywhere. So
 * `coming_soon` is a third state that keeps the row in the ladder, and the
 * second test below is the one that would catch a future rewrite reaching for
 * `is_active` instead.
 */

const tierBySlug = async (tx: Tx, slug: string) => {
  const { rows } = await tx.query<{ id: string; price_minor: string }>(
    `select id, price_minor from public.tiers where slug = $1`,
    [slug],
  )
  return rows[0]!
}

const announce = (tx: Tx, slug: string, on = true) =>
  tx.query(`update public.tiers set coming_soon = $2 where slug = $1`, [slug, on])

const bandMaxOf = async (tx: Tx, slug: string) => {
  const tier = await tierBySlug(tx, slug)
  const { rows } = await tx.query<{ max: string }>(
    `select public.plan_band_max_minor($1) as max`,
    [tier.id],
  )
  return Number(rows[0]!.max)
}

const buy = (tx: Tx, userId: string, tierId: string, minor: number) =>
  tx.query(`select * from public.start_subscription_payment($1, $2, 'paystack', $3::bigint)`, [
    userId,
    tierId,
    minor,
  ])

describe.skipIf(!HAS_DB)('buying a plan that is only announced', () => {
  it('is refused, whatever the card looked like', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const platinum = PINNED_LADDER.find((r) => r.slug === 'platinum')!
      await announce(tx, 'platinum')

      const buyer = await createUser(tx)
      const tier = await tierBySlug(tx, 'platinum')

      const message = await expectRejection(tx, () =>
        buy(tx, buyer.id, tier.id, platinum.priceGhs * 100),
      )

      /* Named, not generic. The one thing somebody who reaches this deserves
         is to be told which plan is not open yet. */
      expect(message).toMatch(/not on sale yet/i)
      expect(message).toMatch(/platinum/i)
    })
  })

  it('still sells every plan that is not announced', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      await announce(tx, 'platinum')
      const gold = PINNED_LADDER.find((r) => r.slug === 'gold')!

      const buyer = await createUser(tx)
      const tier = await tierBySlug(tx, 'gold')

      const { rows } = await buy(tx, buyer.id, tier.id, gold.priceGhs * 100)
      expect(rows[0]!.status).toBe('pending')
    })
  })
})

describe.skipIf(!HAS_DB)('what announcing a plan must NOT change', () => {
  it('leaves the band of the plan below it exactly where it was', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)

      const before = await bandMaxOf(tx, 'gold')
      await announce(tx, 'platinum')
      const after = await bandMaxOf(tx, 'gold')

      /* ⚠️ If this ever fails, somebody has made `coming_soon` filter the
         ladder. Gold's ceiling is cut against Platinum's price; dropping
         Platinum moves it to Diamond's and changes what every Gold buyer is
         charged at the top of their band. */
      expect(after).toBe(before)
    })
  })

  it('and hiding that plan instead WOULD have moved it, which is the point', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)

      const before = await bandMaxOf(tx, 'gold')
      await tx.query(`update public.tiers set is_active = false where slug = 'platinum'`)
      const after = await bandMaxOf(tx, 'gold')

      /* Not a rule being asserted, a difference being demonstrated: this is
         the cost the test above is protecting against, measured. */
      expect(after).not.toBe(before)
    })
  })

  it('does not touch a subscription somebody already paid for', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const platinum = PINNED_LADDER.find((r) => r.slug === 'platinum')!
      const buyer = await createUser(tx)
      const tier = await tierBySlug(tx, 'platinum')

      const { rows } = await buy(tx, buyer.id, tier.id, platinum.priceGhs * 100)
      await tx.query(`select * from public.confirm_subscription_payment($1, $2)`, [
        rows[0]!.id,
        `TEST-ANNOUNCE-${rows[0]!.id}`,
      ])

      await announce(tx, 'platinum')

      /* Announcing stops NEW purchases. What somebody bought keeps running to
         its end date, because the tier they hold is resolved from the row, not
         from this flag. */
      const { rows: live } = await tx.query<{ n: string }>(
        `select count(*)::text as n from public.user_subscriptions
          where user_id = $1 and status in ('active', 'grace')`,
        [buyer.id],
      )
      expect(Number(live[0]!.n)).toBe(1)
    })
  })
})

describe.skipIf(!HAS_DB)('who may announce a plan', () => {
  it('lets an administrator turn it on and off again', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const admin = await createAdmin(tx)
      const tier = await tierBySlug(tx, 'platinum')

      await tx.query(`select * from public.admin_set_plan_coming_soon($1, $2, true)`, [
        admin.id,
        tier.id,
      ])
      const on = await tx.query<{ coming_soon: boolean }>(
        `select coming_soon from public.tiers where id = $1`,
        [tier.id],
      )
      expect(on.rows[0]!.coming_soon).toBe(true)

      await tx.query(`select * from public.admin_set_plan_coming_soon($1, $2, false)`, [
        admin.id,
        tier.id,
      ])
      const off = await tx.query<{ coming_soon: boolean }>(
        `select coming_soon from public.tiers where id = $1`,
        [tier.id],
      )
      expect(off.rows[0]!.coming_soon).toBe(false)
    })
  })

  it('refuses anybody who is not an administrator', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const nobody = await createUser(tx)
      const tier = await tierBySlug(tx, 'platinum')

      const message = await expectRejection(tx, () =>
        tx.query(`select * from public.admin_set_plan_coming_soon($1, $2, true)`, [
          nobody.id,
          tier.id,
        ]),
      )
      expect(message).toMatch(/admin/i)
    })
  })

  it('refuses to announce the starting plan, which everybody is already on', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const admin = await createAdmin(tx)
      const free = await tierBySlug(tx, 'free')

      const message = await expectRejection(tx, () =>
        tx.query(`select * from public.admin_set_plan_coming_soon($1, $2, true)`, [
          admin.id,
          free.id,
        ]),
      )
      expect(message).toMatch(/starting plan/i)
    })
  })
})

describe.skipIf(!HAS_DB)('the plan editor', () => {
  it('sets the flag when the save mentions it', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const admin = await createAdmin(tx)
      const tier = await tierBySlug(tx, 'gold')

      await tx.query(`select * from public.admin_save_plan($1, $2::jsonb)`, [
        admin.id,
        JSON.stringify({ id: tier.id, slug: 'gold', name: 'Gold', comingSoon: true }),
      ])

      const { rows } = await tx.query<{ coming_soon: boolean }>(
        `select coming_soon from public.tiers where id = $1`,
        [tier.id],
      )
      expect(rows[0]!.coming_soon).toBe(true)
    })
  })

  it('leaves it alone when the save does not', async () => {
    await withRollback(async (tx) => {
      await pinLadder(tx)
      const admin = await createAdmin(tx)
      const tier = await tierBySlug(tx, 'platinum')
      await announce(tx, 'platinum')

      /* ⚠️ An editor that saves a name must not put an announced plan back on
         sale by not mentioning it. Same rule the band ceilings follow. */
      await tx.query(`select * from public.admin_save_plan($1, $2::jsonb)`, [
        admin.id,
        JSON.stringify({ id: tier.id, slug: 'platinum', name: 'Platinum Plus' }),
      ])

      const { rows } = await tx.query<{ name: string; coming_soon: boolean }>(
        `select name, coming_soon from public.tiers where id = $1`,
        [tier.id],
      )
      expect(rows[0]!.name).toBe('Platinum Plus')
      expect(rows[0]!.coming_soon).toBe(true)
    })
  })
})
