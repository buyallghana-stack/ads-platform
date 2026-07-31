import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  actAs,
  actAsAdmin,
  createAdmin,
  createUser,
  expectRejection,
  withRollback,
} from '../support/db'

/**
 * Three staff roles, and the line between them.
 *
 * This is in the money suite because of what the line protects: `assert_admin`
 * is the gate in front of every function that decides a payout, moves points,
 * re-prices a plan or hands out a gift code. Migration 086 narrowed it to
 * SUPER ADMIN so that everything not explicitly delegated is closed to the two
 * new roles by omission — the tests that matter are therefore the refusals,
 * not the grants.
 */

const setRole = async (tx: Tx, userId: string, role: string) => {
  await tx.query(`delete from public.user_roles where user_id = $1`, [userId])
  await tx.query(`insert into public.user_roles (user_id, role) values ($1, $2::public.app_role)`, [
    userId,
    role,
  ])
}

const staff = async (tx: Tx, role: string, name: string) => {
  const person = await createUser(tx, { name })
  await setRole(tx, person.id, role)
  return person
}

const roleOf = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ role: string | null }>(
    `select public.admin_role($1) as role`,
    [userId],
  )
  return rows[0]!.role
}

describe.skipIf(!HAS_DB)('staff roles — who the database lets through', () => {
  it('lets a super admin through the gate every money function uses', async () => {
    await withRollback(async (tx) => {
      const boss = await staff(tx, 'super_admin', 'Boss')
      await expect(tx.query(`select public.assert_admin($1)`, [boss.id])).resolves.toBeTruthy()
    })
  })

  it('still accepts the role name that existed before the split', async () => {
    await withRollback(async (tx) => {
      // `createAdmin` writes 'admin', which is what every administrator held
      // until 2026-07-31. A browser holding a token issued before the change
      // must not lock its owner out of their own console.
      const legacy = await createAdmin(tx)
      expect(await roleOf(tx, legacy.id)).toBe('admin')
      await expect(tx.query(`select public.assert_admin($1)`, [legacy.id])).resolves.toBeTruthy()
    })
  })

  it('refuses support and ads managers at that gate', async () => {
    await withRollback(async (tx) => {
      const support = await staff(tx, 'support', 'Support')
      const ads = await staff(tx, 'ads_manager', 'Ads')

      // Everything from approving a payout to rewriting config sits behind
      // this one call, so one refusal here closes all of it.
      expect(await expectRejection(tx, () => tx.query(`select public.assert_admin($1)`, [support.id])))
        .toMatch(/not an administrator/i)
      expect(await expectRejection(tx, () => tx.query(`select public.assert_admin($1)`, [ads.id])))
        .toMatch(/not an administrator/i)
    })
  })

  it('opens exactly one area to each delegated role', async () => {
    await withRollback(async (tx) => {
      const support = await staff(tx, 'support', 'Support')
      const ads = await staff(tx, 'ads_manager', 'Ads')
      const boss = await staff(tx, 'super_admin', 'Boss')

      const allowed = async (userId: string, area: string) => {
        const { rows } = await tx.query<{ ok: boolean }>(
          `select public.admin_area_allowed($1, $2) as ok`,
          [userId, area],
        )
        return rows[0]!.ok
      }

      expect(await allowed(support.id, 'support')).toBe(true)
      expect(await allowed(support.id, 'ads')).toBe(false)
      expect(await allowed(ads.id, 'ads')).toBe(true)
      expect(await allowed(ads.id, 'support')).toBe(false)
      // A super admin is allowed everywhere, including areas nobody has
      // invented yet — which is what keeps a new area from silently locking
      // out the only person who can fix it.
      expect(await allowed(boss.id, 'support')).toBe(true)
      expect(await allowed(boss.id, 'ads')).toBe(true)
      expect(await allowed(boss.id, 'something_new')).toBe(true)
    })
  })

  it('refuses an ordinary user everywhere', async () => {
    await withRollback(async (tx) => {
      const nobody = await createUser(tx, { name: 'Nobody' })
      expect(await roleOf(tx, nobody.id)).not.toBe('super_admin')
      await expectRejection(tx, () => tx.query(`select public.assert_admin($1)`, [nobody.id]))
      await expectRejection(tx, () =>
        tx.query(`select public.assert_admin_area($1, 'support')`, [nobody.id]),
      )
    })
  })
})

describe.skipIf(!HAS_DB)('staff roles — granting and revoking', () => {
  it('replaces the role rather than adding a second one', async () => {
    await withRollback(async (tx) => {
      const boss = await staff(tx, 'super_admin', 'Boss')
      const person = await createUser(tx, { name: 'New Staff' })

      await tx.query(`select public.admin_grant_role($1, $2, 'support')`, [boss.id, person.id])
      await tx.query(`select public.admin_grant_role($1, $2, 'ads_manager')`, [boss.id, person.id])

      // user_roles is keyed on (user_id, role), so nothing in the schema stops
      // somebody holding two. `admin_role` would then be a precedence puzzle
      // at exactly the moment an operator is trying to REDUCE access.
      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.user_roles where user_id = $1`,
        [person.id],
      )
      expect(rows[0]!.n).toBe(1)
      expect(await roleOf(tx, person.id)).toBe('ads_manager')
    })
  })

  it('refuses a role nobody defined', async () => {
    await withRollback(async (tx) => {
      const boss = await staff(tx, 'super_admin', 'Boss')
      const person = await createUser(tx, { name: 'New Staff' })

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_grant_role($1, $2, 'owner')`, [boss.id, person.id]),
      )
      expect(message).toMatch(/unknown role/i)
    })
  })

  it('does not let a delegated role hand out access', async () => {
    await withRollback(async (tx) => {
      const support = await staff(tx, 'support', 'Support')
      const person = await createUser(tx, { name: 'Friend' })

      // The most valuable refusal in the file: without it, the smallest role
      // could promote itself to the largest one.
      await expectRejection(tx, () =>
        tx.query(`select public.admin_grant_role($1, $2, 'super_admin')`, [support.id, person.id]),
      )
      expect(await roleOf(tx, person.id)).not.toBe('super_admin')
    })
  })

  it('will not let anybody revoke themselves', async () => {
    await withRollback(async (tx) => {
      const boss = await staff(tx, 'super_admin', 'Boss')

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_revoke_role($1, $1)`, [boss.id]),
      )
      expect(message).toMatch(/your own access/i)
    })
  })

  it('leaves a revoked administrator as an ordinary user, not a deleted one', async () => {
    await withRollback(async (tx) => {
      const boss = await staff(tx, 'super_admin', 'Boss')
      const support = await staff(tx, 'support', 'Support')

      await tx.query(`select public.admin_revoke_role($1, $2)`, [boss.id, support.id])

      // They keep their account, their balance and their history. Revoking a
      // job is not deleting a person.
      expect(await roleOf(tx, support.id)).toBe('user')
      await expectRejection(tx, () => tx.query(`select public.assert_admin($1)`, [support.id]))
    })
  })

  it('refuses to revoke somebody who was never staff', async () => {
    await withRollback(async (tx) => {
      const boss = await staff(tx, 'super_admin', 'Boss')
      const nobody = await createUser(tx, { name: 'Nobody' })

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_revoke_role($1, $2)`, [boss.id, nobody.id]),
      )
      expect(message).toMatch(/not an administrator/i)
    })
  })
})

describe.skipIf(!HAS_DB)('staff roles — what a session is told', () => {
  it('reads the table, not the token, so revocation is immediate', async () => {
    await withRollback(async (tx) => {
      const boss = await staff(tx, 'super_admin', 'Boss')

      // A session whose token still claims `admin` — which is exactly what a
      // browser holds for up to an hour after somebody presses Revoke.
      await actAsAdmin(tx, boss.id)
      const seenWhileStaff = await tx.query<{ ok: boolean }>(`select public.is_admin() as ok`)
      expect(seenWhileStaff.rows[0]!.ok).toBe(true)

      await tx.query(`update public.user_roles set role = 'user' where user_id = $1`, [boss.id])

      const seenAfter = await tx.query<{ ok: boolean }>(`select public.is_admin() as ok`)
      expect(seenAfter.rows[0]!.ok).toBe(false)
    })
  })

  it('counts every staff role as staff for the screens they share', async () => {
    await withRollback(async (tx) => {
      const support = await staff(tx, 'support', 'Support')
      await actAs(tx, support.id)

      // `is_admin` is the READ side: it is what lets support open the console
      // at all. The write gate above is what keeps them out of the money.
      const { rows } = await tx.query<{ ok: boolean }>(`select public.is_admin() as ok`)
      expect(rows[0]!.ok).toBe(true)
    })
  })
})
