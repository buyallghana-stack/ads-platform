import { describe, expect, it } from 'vitest'

import {
  HAS_DB,
  type Tx,
  balanceOf,
  createAdmin,
  createUser,
  expectRejection,
  setConfig,
  withRollback,
} from '../support/db'

/**
 * Gift codes.
 *
 * The operator's requirement is one sentence — "under no circumstance should a
 * single code be redeemed twice" — and it is the only thing here that really
 * matters, because the failure mode is minting points. Most of this file is
 * that one property attacked from different directions: sequentially, by a
 * second user, through a revoked code, through a code whose status column has
 * been tampered back to active, and by inserting straight into the table.
 *
 * The CONCURRENT case — two connections redeeming the same instant — is not
 * here. It cannot be: `withRollback` gives each test a single transaction that
 * is rolled back, and two transactions cannot race inside one. It lives in
 * `scripts/verify-gift-code-race.mjs`, which uses two real connections and a
 * real commit, and cleans up after itself.
 */

const newCode = async (tx: Tx, adminId: string, points = 5_000, note?: string) => {
  const { rows: gen } = await tx.query<{ code: string }>(`select public.generate_gift_code() as code`)
  const { rows } = await tx.query(
    `select * from public.admin_create_gift_code($1, $2, $3, $4)`,
    [adminId, gen[0]!.code, points, note ?? null],
  )
  return rows[0] as { id: string; code: string; points: string; status: string }
}

const redeem = async (tx: Tx, userId: string, code: string) => {
  const { rows } = await tx.query<{ r: Record<string, unknown> }>(
    `select public.redeem_gift_code($1, $2) as r`,
    [userId, code],
  )
  return rows[0]!.r
}

describe.skipIf(!HAS_DB)('generating a code', () => {
  it('produces a 12-character code from the unambiguous alphabet', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query<{ code: string }>(
        `select public.generate_gift_code() as code from generate_series(1, 25)`,
      )
      for (const r of rows) {
        // No I, L, O or U: a code read off a screen must not be mistypeable
        // into a different valid code.
        expect(r.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/)
      }
      // 25 draws from 32^12 colliding would mean the CSPRNG is not one.
      expect(new Set(rows.map((r) => r.code)).size).toBe(25)
    })
  })

  it('creates nothing until the admin saves', async () => {
    await withRollback(async (tx) => {
      const { rows: before } = await tx.query(`select count(*)::int n from public.gift_codes`)
      await tx.query(`select public.generate_gift_code()`)
      const { rows: after } = await tx.query(`select count(*)::int n from public.gift_codes`)
      // An abandoned form must not leave an orphan code behind.
      expect(after[0]!.n).toBe(before[0]!.n)
    })
  })

  it('refuses a code the generator did not produce', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      // The whole point of generating is that an admin cannot pick something
      // guessable like GIFT00000001.
      for (const bad of ['HELLO', 'GIFT00000001', 'AAAAAAAAAAAI']) {
        const message = await expectRejection(tx, () =>
          tx.query(`select public.admin_create_gift_code($1, $2, 5000)`, [admin.id, bad]),
        )
        expect(message).toMatch(/not a generated code/i)
      }
    })
  })

  it('refuses a code worth nothing', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const { rows: gen } = await tx.query<{ code: string }>(
        `select public.generate_gift_code() as code`,
      )
      for (const points of [0, -100]) {
        const message = await expectRejection(tx, () =>
          tx.query(`select public.admin_create_gift_code($1, $2, $3)`, [
            admin.id,
            gen[0]!.code,
            points,
          ]),
        )
        expect(message).toMatch(/how many points/i)
      }
    })
  })

  it('is refused to a non-admin', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      const { rows: gen } = await tx.query<{ code: string }>(
        `select public.generate_gift_code() as code`,
      )
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_create_gift_code($1, $2, 5000)`, [user.id, gen[0]!.code]),
      )
      expect(message).toMatch(/admin/i)
    })
  })
})

describe.skipIf(!HAS_DB)('redeeming', () => {
  it('pays the points and marks the code redeemed', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 7_500)

      const result = await redeem(tx, user.id, code.code)

      expect(result).toMatchObject({ outcome: 'ok', points: 7500 })
      expect(await balanceOf(tx, user.id)).toBe(7_500)

      const { rows } = await tx.query(`select status from public.gift_codes where id = $1`, [code.id])
      expect(rows[0]!.status).toBe('redeemed')
    })
  })

  it('accepts the code in any case, with stray spaces', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 1_000)

      // People paste these out of WhatsApp. Case must not decide whether
      // somebody gets paid.
      const result = await redeem(tx, user.id, `  ${code.code.toLowerCase()} `)
      expect(result).toMatchObject({ outcome: 'ok' })
    })
  })

  it('records what was paid, so editing the code later cannot rewrite it', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 2_000)
      await redeem(tx, user.id, code.code)

      await tx.query(`update public.gift_codes set points = 999999 where id = $1`, [code.id])

      const { rows } = await tx.query(
        `select points_awarded from public.gift_code_redemptions where gift_code_id = $1`,
        [code.id],
      )
      expect(Number(rows[0]!.points_awarded)).toBe(2_000)
      expect(await balanceOf(tx, user.id)).toBe(2_000)
    })
  })
})

describe.skipIf(!HAS_DB)('a code cannot be redeemed twice', () => {
  it('refuses the same user a second time', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)

      expect(await redeem(tx, user.id, code.code)).toMatchObject({ outcome: 'ok' })
      expect(await redeem(tx, user.id, code.code)).toMatchObject({ outcome: 'already_used' })

      expect(await balanceOf(tx, user.id)).toBe(5_000)
    })
  })

  it('refuses a DIFFERENT user — one code, one redemption, globally', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const first = await createUser(tx)
      const second = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)

      expect(await redeem(tx, first.id, code.code)).toMatchObject({ outcome: 'ok' })
      expect(await redeem(tx, second.id, code.code)).toMatchObject({ outcome: 'already_used' })

      expect(await balanceOf(tx, second.id)).toBe(0)
    })
  })

  it('still refuses when the status column is tampered back to active', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const first = await createUser(tx)
      const second = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)

      await redeem(tx, first.id, code.code)

      /*
        The status column is a convenience. This forces the exact state a bug
        or a stray UPDATE would produce — redeemed once, but marked active —
        and the redemption must STILL be refused, because the guarantee is the
        unique constraint on gift_code_redemptions, not the status.
      */
      await tx.query(`update public.gift_codes set status = 'active' where id = $1`, [code.id])

      expect(await redeem(tx, second.id, code.code)).toMatchObject({ outcome: 'already_used' })
      expect(await balanceOf(tx, second.id)).toBe(0)
    })
  })

  it('cannot record two redemptions of one code, even directly', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const first = await createUser(tx)
      const second = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)
      await redeem(tx, first.id, code.code)

      // Bypassing the function entirely. The guarantee has to live in the
      // schema, or it is only as good as every future caller.
      const message = await expectRejection(tx, () =>
        tx.query(
          `insert into public.gift_code_redemptions (gift_code_id, user_id, points_awarded)
           values ($1, $2, 5000)`,
          [code.id, second.id],
        ),
      )
      expect(message).toMatch(/duplicate key|unique/i)
    })
  })
})

describe.skipIf(!HAS_DB)('refusing a code', () => {
  it('refuses a revoked code', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)

      await tx.query(`select public.admin_revoke_gift_code($1, $2)`, [admin.id, code.id])

      expect(await redeem(tx, user.id, code.code)).toMatchObject({ outcome: 'revoked' })
      expect(await balanceOf(tx, user.id)).toBe(0)
    })
  })

  it('refuses an expired code', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)
      await tx.query(`update public.gift_codes set expires_at = now() - interval '1 day' where id = $1`, [
        code.id,
      ])

      expect(await redeem(tx, user.id, code.code)).toMatchObject({ outcome: 'expired' })
    })
  })

  it('refuses a code that does not exist, without saying so differently', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      // Same shape, never issued. Must not be distinguishable from a revoked
      // one in a way that helps somebody map the code space.
      expect(await redeem(tx, user.id, 'ABCDEFGHJKMN')).toMatchObject({ outcome: 'not_found' })
      expect(await redeem(tx, user.id, 'nonsense')).toMatchObject({ outcome: 'not_found' })
    })
  })

  it('refuses a disabled account', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)
      await tx.query(`update public.profiles set disabled_at = now() where id = $1`, [user.id])

      expect(await redeem(tx, user.id, code.code)).toMatchObject({ outcome: 'account_disabled' })
      // And the code survives for somebody legitimate.
      const { rows } = await tx.query(`select status from public.gift_codes where id = $1`, [code.id])
      expect(rows[0]!.status).toBe('active')
    })
  })

  it('stops a user guessing after the configured number of tries', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      await setConfig(tx, 'gift_code_max_attempts_per_hour', '3')

      for (let i = 0; i < 3; i++) {
        expect(await redeem(tx, user.id, 'ABCDEFGHJKM' + i)).toMatchObject({ outcome: 'not_found' })
      }
      expect(await redeem(tx, user.id, 'ABCDEFGHJKMN')).toMatchObject({ outcome: 'rate_limited' })
    })
  })

  it('does not count a successful redemption against the guess limit', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      await setConfig(tx, 'gift_code_max_attempts_per_hour', '3')
      const code = await newCode(tx, admin.id, 1_000)

      expect(await redeem(tx, user.id, code.code)).toMatchObject({ outcome: 'ok' })

      const { rows } = await tx.query(
        `select count(*)::int n from public.gift_code_attempts where user_id = $1`,
        [user.id],
      )
      expect(rows[0]!.n).toBe(0)
    })
  })
})

describe.skipIf(!HAS_DB)('revoking', () => {
  it('refuses to revoke a code that has already been redeemed', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)
      await redeem(tx, user.id, code.code)

      // The points are in somebody's balance. A screen that let an operator
      // "revoke" that would be telling them something untrue.
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_revoke_gift_code($1, $2)`, [admin.id, code.id]),
      )
      expect(message).toMatch(/already been redeemed/i)
    })
  })

  it('is idempotent, so a second click does nothing', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const code = await newCode(tx, admin.id, 5_000)

      await tx.query(`select public.admin_revoke_gift_code($1, $2)`, [admin.id, code.id])
      const { rows: first } = await tx.query(
        `select revoked_at from public.gift_codes where id = $1`,
        [code.id],
      )
      await tx.query(`select public.admin_revoke_gift_code($1, $2)`, [admin.id, code.id])
      const { rows: second } = await tx.query(
        `select revoked_at, status from public.gift_codes where id = $1`,
        [code.id],
      )

      expect(second[0]!.status).toBe('revoked')
      expect(second[0]!.revoked_at).toEqual(first[0]!.revoked_at)
    })
  })

  it('records who revoked it', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const code = await newCode(tx, admin.id, 5_000)
      await tx.query(`select public.admin_revoke_gift_code($1, $2)`, [admin.id, code.id])

      const { rows } = await tx.query(
        `select revoked_by, revoked_at from public.gift_codes where id = $1`,
        [code.id],
      )
      expect(rows[0]!.revoked_by).toBe(admin.id)
      expect(rows[0]!.revoked_at).not.toBeNull()
    })
  })

  it('is refused to a non-admin', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const user = await createUser(tx)
      const code = await newCode(tx, admin.id, 5_000)

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_revoke_gift_code($1, $2)`, [user.id, code.id]),
      )
      expect(message).toMatch(/admin/i)
    })
  })
})

describe.skipIf(!HAS_DB)('what a user can see', () => {
  it('does not let a signed-in user list codes', async () => {
    await withRollback(async (tx) => {
      // Reading the table would hand somebody every unredeemed voucher on the
      // platform. There is deliberately no user-facing read policy at all.
      const { rows: policies } = await tx.query(
        `select polname, pg_get_expr(polqual, polrelid) as using_expr
           from pg_policy
          where polrelid = 'public.gift_codes'::regclass`,
      )
      expect(policies).toHaveLength(1)
      expect(policies[0]!.using_expr).toMatch(/is_admin/)
    })
  })
})
