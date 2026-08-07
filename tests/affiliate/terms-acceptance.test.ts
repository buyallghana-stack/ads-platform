import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, setConfig, withRollback } from '../support/db'

/**
 * Every affiliate account records which terms it accepted (H47).
 *
 * No affiliate agreement is being drafted, but the versioned acceptance
 * MECHANISM had to exist from the start, because it cannot be reconstructed
 * later: an account created without it can never be made to say what its owner
 * agreed to.
 *
 * ⚠️ THE STAMP IS A TRIGGER, AND THIS TEST IS WHY. An affiliate account is
 * created in four places, and a stamp written into one join path is a stamp
 * missing from three. These tests insert the row directly, the way the least
 * careful of those paths does, so a fifth path written next year is covered
 * without anybody remembering to cover it.
 */

const account = async (tx: Tx, name: string) => {
  const user = await createUser(tx, { name })
  await tx.query(
    `insert into public.affiliate_accounts (user_id, affiliate_code, status)
     values ($1, public.generate_affiliate_code(), 'pending')`,
    [user.id],
  )
  const { rows } = await tx.query<{
    terms_version: number | null
    terms_accepted_at: string | null
  }>(
    `select terms_version, terms_accepted_at from public.affiliate_accounts where user_id = $1`,
    [user.id],
  )
  return { user, row: rows[0]! }
}

describe.skipIf(!HAS_DB)('terms acceptance', () => {
  it('stamps the current version on a new affiliate, however it was created', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_terms_version', '3')
      const { row } = await account(tx, 'Fresh Affiliate')

      expect(row.terms_version).toBe(3)
      expect(row.terms_accepted_at).not.toBeNull()
    })
  })

  it('keeps the version somebody accepted when the terms move on', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_terms_version', '1')
      const { user, row } = await account(tx, 'Early Joiner')
      expect(row.terms_version).toBe(1)

      /* The operator rewrites the terms. What this person agreed to does not
         change retroactively — that is the entire point of versioning it. */
      await setConfig(tx, 'affiliate_terms_version', '2')

      const { rows } = await tx.query<{ terms_version: number }>(
        `select terms_version from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )
      expect(rows[0]!.terms_version).toBe(1)
    })
  })

  it('does not overwrite a version the caller supplied', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_terms_version', '5')
      const user = await createUser(tx, { name: 'Imported Affiliate' })

      /* A backfill or an import carries its own record, and rewriting it would
         be rewriting history. */
      await tx.query(
        `insert into public.affiliate_accounts
           (user_id, affiliate_code, status, terms_version, terms_accepted_at)
         values ($1, public.generate_affiliate_code(), 'pending', 2, now() - interval '90 days')`,
        [user.id],
      )

      const { rows } = await tx.query<{ terms_version: number; days: string }>(
        `select terms_version,
                extract(day from now() - terms_accepted_at)::text as days
           from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )
      expect(rows[0]!.terms_version).toBe(2)
      expect(Number(rows[0]!.days)).toBeGreaterThan(80)
    })
  })

  it('reports who is behind the current version, without blocking them', async () => {
    await withRollback(async (tx) => {
      await setConfig(tx, 'affiliate_terms_version', '1')
      const { user } = await account(tx, 'Behind The Times')
      await setConfig(tx, 'affiliate_terms_version', '4')

      const { rows: admin } = await tx.query<{ id: string }>(
        `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
      )
      const { rows } = await tx.query<{ is_current: boolean; terms_version: number }>(
        `select s.is_current, s.terms_version
           from public.admin_affiliate_terms_status($1) s
           join public.affiliate_accounts a on a.id = s.affiliate_id
          where a.user_id = $2`,
        [admin[0]!.id, user.id],
      )

      expect(rows[0]!.terms_version).toBe(1)
      expect(rows[0]!.is_current).toBe(false)

      /* H47 asks for the record, not for a gate. Being behind must not stop
         somebody earning or withdrawing: locking people out of their own money
         over a wording change would be a worse answer than a report. */
      const { rows: canEarn } = await tx.query<{ n: number }>(
        `select public.affiliate_weekly_play_allowance($1) as n`,
        [user.id],
      )
      expect(canEarn[0]!.n).toBeGreaterThanOrEqual(0)
    })
  })
})
