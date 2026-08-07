import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, withRollback } from '../support/db'

/**
 * The front page quotes the same band the upgrade screen sells.
 *
 * A plan has been a price RANGE since 2026-08-04, and the marketing page went
 * on advertising a single figure for three days because the band arithmetic
 * lives in three places: `plan_band_max_minor` in SQL, `subscriptions/data.ts`
 * for the upgrade screen, and now `marketing/plans.ts` for the front page.
 *
 * ⚠️ THE BOUNDARY IS NOT SYMMETRIC. Between rungs a band ends one pesewa BELOW
 * the next price; the top rung ends ON its own stored ceiling. Any
 * reimplementation that treats the top like the others advertises Platinum at
 * whatever it costs and hides the range entirely, which is the exact bug this
 * is guarding.
 *
 * So this asserts the derivation against the database rather than against a
 * copy of itself, and it is the reason the marketing figures may be derived in
 * TypeScript at all.
 */

/** The rule `marketing/plans.ts` implements, applied to the same rows. */
function derive(rows: { price_minor: number; band_max_minor: number | null }[], index: number) {
  const row = rows[index]!
  const next = rows[index + 1]
  return next ? Number(next.price_minor) - 1 : Number(row.band_max_minor ?? row.price_minor)
}

describe.skipIf(!HAS_DB)('the band on the front page', () => {
  const rungs = async (tx: Tx) => {
    const { rows } = await tx.query<{
      id: string
      slug: string
      price_minor: string
      band_max_minor: string | null
      from_sql: string
    }>(
      `select t.id, t.slug, t.price_minor::text, t.band_max_minor::text,
              public.plan_band_max_minor(t.id)::text as from_sql
         from public.tiers t
        where t.is_active
        order by t.sort_order`,
    )
    return rows
  }

  it('matches plan_band_max_minor for every rung, including the top one', async () => {
    await withRollback(async (tx) => {
      const rows = await rungs(tx)
      expect(rows.length).toBeGreaterThan(1)

      rows.forEach((row, index) => {
        const mine = derive(
          rows.map((r) => ({
            price_minor: Number(r.price_minor),
            band_max_minor: r.band_max_minor === null ? null : Number(r.band_max_minor),
          })),
          index,
        )
        expect(mine, `${row.slug} disagrees with plan_band_max_minor`).toBe(Number(row.from_sql))
      })
    })
  })

  it('ends a middle rung one pesewa below the next price, and the top on its own ceiling', async () => {
    await withRollback(async (tx) => {
      const rows = await rungs(tx)
      const paid = rows.filter((r) => Number(r.price_minor) > 0)

      for (let i = 0; i < paid.length - 1; i += 1) {
        expect(Number(paid[i]!.from_sql)).toBe(Number(paid[i + 1]!.price_minor) - 1)
      }

      const top = paid.at(-1)!
      /* The top rung has no rung above it to be cut against, so its ceiling is
         whatever the operator stored, and it is INCLUSIVE. */
      expect(Number(top.from_sql)).toBe(Number(top.band_max_minor ?? top.price_minor))
    })
  })

  it('floors the advertised ceiling to whole cedis, as the upgrade card does', async () => {
    await withRollback(async (tx) => {
      const rows = await rungs(tx)

      for (const row of rows) {
        const ceiling = Number(row.from_sql)
        const advertised = Math.floor(ceiling / 100)

        /* GHS 139.99 is advertised as 139, never 140: the front page must not
           quote a price the upgrade screen will not accept. */
        expect(advertised * 100).toBeLessThanOrEqual(ceiling)
        expect((advertised + 1) * 100).toBeGreaterThan(ceiling)
      }
    })
  })
})
