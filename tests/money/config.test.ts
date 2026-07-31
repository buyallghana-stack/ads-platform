import { describe, expect, it } from 'vitest'

import { HAS_DB, createAdmin, createUser, expectRejection, withRollback, type Tx } from '../support/db'

/**
 * Platform settings — the numbers every money path reads.
 *
 * `app_config` decides the daily points cap, the points-to-cedi rate, the
 * redemption holding period, the referral bonuses and the two kill switches.
 * Nothing else in the system has that reach, and until migration 052 there
 * was no way to write it except a service-role statement typed by hand.
 *
 * These tests care about one thing above the others: a value that would break
 * a money path cannot be written THROUGH ANY ROUTE the application has.
 */

/** Current value of a setting, as stored. */
async function configValue(tx: Tx, key: string): Promise<string> {
  const { rows } = await tx.query<{ value: string }>(
    `select value from public.app_config where key = $1`,
    [key],
  )
  return rows[0]!.value
}

async function setConfigAs(tx: Tx, adminId: string, values: Record<string, string>) {
  return tx.query<{ config_key: string; previous_value: string; new_value: string }>(
    `select * from public.admin_set_config($1, $2::jsonb)`,
    [adminId, JSON.stringify(values)],
  )
}

describe.skipIf(!HAS_DB)('who may change platform settings', () => {
  it('refuses an account that is not an administrator', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      const before = await configValue(tx, 'ad_retry_cap')

      const message = await expectRejection(tx, () =>
        setConfigAs(tx, user.id, { ad_retry_cap: '5' }),
      )
      expect(message).toMatch(/not an administrator/i)
      expect(await configValue(tx, 'ad_retry_cap')).toBe(before)
    })
  })

  it('records which administrator made the change', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await setConfigAs(tx, admin.id, { ad_retry_cap: '7' })

      // The stamp trigger uses coalesce(auth.uid(), new.updated_by), and
      // auth.uid() is null through the service client — so if the function
      // stopped naming the admin, attribution would silently become null.
      const { rows } = await tx.query<{ updated_by: string }>(
        `select updated_by from public.app_config where key = 'ad_retry_cap'`,
      )
      expect(rows[0]!.updated_by).toBe(admin.id)
    })
  })

  it('writes an audit entry for each setting that changed', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      await setConfigAs(tx, admin.id, {
        ad_retry_cap: '7',
        fraud_threshold_medium: '35',
      })

      // Scoped to THIS admin. These tests run against the shared dev
      // database, where app_config has a real history — counting every audit
      // row for a key would count changes made months ago by somebody else.
      // The fixture admin is freshly created per test, so their id is the
      // only reliable "what did this test cause".
      const { rows } = await tx.query<{ entity_id: string }>(
        `select entity_id from public.admin_audit_log
          where entity_type = 'app_config' and actor_id = $1
          order by entity_id`,
        [admin.id],
      )
      expect(rows.map((r) => r.entity_id)).toEqual(['ad_retry_cap', 'fraud_threshold_medium'])
    })
  })
})

describe.skipIf(!HAS_DB)('values a setting may take', () => {
  it('refuses a key that does not exist rather than creating it', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // The dangerous failure is not an error — it is an INSERT that succeeds
      // and produces a setting nothing reads, which looks saved forever.
      const message = await expectRejection(tx, () =>
        setConfigAs(tx, admin.id, { daily_cap_typo: '500' }),
      )
      expect(message).toMatch(/unknown setting/i)

      const { rows } = await tx.query<{ count: string }>(
        `select count(*) from public.app_config where key = 'daily_cap_typo'`,
      )
      expect(Number(rows[0]!.count)).toBe(0)
    })
  })

  it('refuses a value above the row maximum', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const before = await configValue(tx, 'ad_retry_cap')

      const message = await expectRejection(tx, () =>
        setConfigAs(tx, admin.id, { ad_retry_cap: '99' }),
      )
      // Names the field and the limit — "violates check constraint
      // app_config_value_in_range" would tell an operator nothing.
      expect(message).toMatch(/ad_retry_cap must be at most 10/i)
      expect(await configValue(tx, 'ad_retry_cap')).toBe(before)
    })
  })

  it('refuses a value below the row minimum', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // A rate of zero would divide by zero everywhere points become cedis.
      const message = await expectRejection(tx, () =>
        setConfigAs(tx, admin.id, { points_per_currency_unit: '0' }),
      )
      expect(message).toMatch(/at least 1/i)
    })
  })

  it('refuses a non-numeric value for a number', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      const message = await expectRejection(tx, () =>
        setConfigAs(tx, admin.id, { per_user_daily_points_cap: 'lots' }),
      )
      expect(message).toMatch(/whole number/i)
    })
  })

  it('refuses anything but true or false for a switch', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // "yes" is the plausible mistake, and payouts_enabled is the licence
      // switch — a value it cannot parse must not become truthy.
      //
      // The before-value is READ, not assumed. This asserted `'false'`
      // literally until the operator turned payouts on for real, at which
      // point a passing test started failing because the world changed
      // rather than because the code did. What it always meant is that a
      // rejected write leaves the setting exactly as it was.
      const before = await configValue(tx, 'payouts_enabled')

      const message = await expectRejection(tx, () =>
        setConfigAs(tx, admin.id, { payouts_enabled: 'yes' }),
      )
      expect(message).toMatch(/true or false/i)
      expect(await configValue(tx, 'payouts_enabled')).toBe(before)
    })
  })

  it('refuses a combine mode the tier resolver does not implement', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // THE ONE THAT FAILS SILENTLY. resolve_user_tier branches on sum_bonus,
      // sum and product, and falls through to max() for anything else. So an
      // unrecognised mode does not error — it quietly changes every
      // subscriber's reward multiplier. The admin screen offered exactly this
      // value until 2026-07-29.
      const message = await expectRejection(tx, () =>
        setConfigAs(tx, admin.id, { subscription_multiplier_combine_mode: 'multiply' }),
      )
      expect(message).toMatch(/must be one of/i)
      expect(await configValue(tx, 'subscription_multiplier_combine_mode')).toBe('sum_bonus')
    })
  })

  it('accepts every mode the resolver does implement', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      for (const mode of ['sum', 'product', 'highest', 'sum_bonus']) {
        await setConfigAs(tx, admin.id, { subscription_multiplier_combine_mode: mode })
        expect(await configValue(tx, 'subscription_multiplier_combine_mode')).toBe(mode)
      }
    })
  })
})

describe.skipIf(!HAS_DB)('what a save reports', () => {
  it('returns only the settings that actually moved', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const unchanged = await configValue(tx, 'ad_retry_cap')

      const { rows } = await setConfigAs(tx, admin.id, {
        ad_retry_cap: unchanged, // deliberately the value it already holds
        fraud_threshold_medium: '35',
      })

      // Re-saving a form must not claim two changes when one happened, and
      // must not stamp updated_by on a row nobody touched.
      expect(rows).toHaveLength(1)
      expect(rows[0]!.config_key).toBe('fraud_threshold_medium')
      expect(rows[0]!.new_value).toBe('35')
    })
  })

  it('reports the previous value alongside the new one', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const before = await configValue(tx, 'redemption_holding_hours')

      const { rows } = await setConfigAs(tx, admin.id, { redemption_holding_hours: '24' })

      expect(rows[0]!.previous_value).toBe(before)
      expect(rows[0]!.new_value).toBe('24')
    })
  })

  it('leaves every setting untouched when one of them is invalid', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)
      const beforeMedium = await configValue(tx, 'fraud_threshold_medium')

      // One statement, one transaction: a form with a good field and a bad
      // one must save neither, or the operator ends up with half a change
      // and no idea which half.
      await expectRejection(tx, () =>
        setConfigAs(tx, admin.id, {
          fraud_threshold_medium: '35',
          ad_retry_cap: '99',
        }),
      )

      expect(await configValue(tx, 'fraud_threshold_medium')).toBe(beforeMedium)
    })
  })
})

describe.skipIf(!HAS_DB)('settings that gate money', () => {
  it('can arm the daily points cap, which is 0 (unlimited) today', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // A pre-launch blocker: 0 means no per-user ceiling at all. This is the
      // screen that has to be able to set it before the platform takes real
      // money.
      await setConfigAs(tx, admin.id, { per_user_daily_points_cap: '5000' })
      expect(await configValue(tx, 'per_user_daily_points_cap')).toBe('5000')

      const { rows } = await tx.query<{ v: string }>(
        `select public.config_int('per_user_daily_points_cap')::text as v`,
      )
      // The setting is not just stored — it is what the earning path reads.
      expect(rows[0]!.v).toBe('5000')
    })
  })

  it('can arm the referral bonuses, which are 0 today', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // Every paid plan advertises a referral percentage, and a percentage of
      // zero is zero — the plans currently multiply nothing.
      await setConfigAs(tx, admin.id, {
        referral_signup_bonus_points: '200',
        referral_activation_bonus_points: '500',
      })

      expect(await configValue(tx, 'referral_signup_bonus_points')).toBe('200')
      expect(await configValue(tx, 'referral_activation_bonus_points')).toBe('500')
    })
  })

  /* The second level ships switched off, which is exactly the state in which
     a stranded setting goes unnoticed: three fields on the admin screen that
     look saved and change nothing would be indistinguishable from three
     fields set to zero. This is the test that says the keys are real, the
     screen can reach them, and the bounds hold. */
  it('can arm the second referral level, which is 0 today', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      await setConfigAs(tx, admin.id, {
        referral_signup_bonus_points_l2: '50',
        referral_activation_bonus_points_l2: '120',
        referral_purchase_commission_percent_l2: '2.5',
      })

      expect(await configValue(tx, 'referral_signup_bonus_points_l2')).toBe('50')
      expect(await configValue(tx, 'referral_activation_bonus_points_l2')).toBe('120')
      expect(await configValue(tx, 'referral_purchase_commission_percent_l2')).toBe('2.5')
    })
  })

  it('refuses a second-level commission above the row maximum', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // 50 is the ceiling on each level. The clamp inside the money path is
      // what stops the two together exceeding a sale, but the config row is
      // the first place an unreasonable number should be refused.
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_set_config($1, $2::jsonb)`, [
          admin.id,
          JSON.stringify({ referral_purchase_commission_percent_l2: '60' }),
        ]),
      )
      expect(message).toMatch(/at most|maximum/i)
    })
  })

  it('can flip the two kill switches both ways', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      await setConfigAs(tx, admin.id, { earning_paused_globally: 'true' })
      const { rows: on } = await tx.query<{ v: boolean }>(
        `select public.config_bool('earning_paused_globally') as v`,
      )
      expect(on[0]!.v).toBe(true)

      await setConfigAs(tx, admin.id, { earning_paused_globally: 'false' })
      const { rows: off } = await tx.query<{ v: boolean }>(
        `select public.config_bool('earning_paused_globally') as v`,
      )
      expect(off[0]!.v).toBe(false)
    })
  })

  it('is the single switch that lets a payout be marked paid', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      // CORRECTED 2026-07-29. This used to be called "cannot start payouts on
      // its own — the environment switch is separate", on the belief that
      // `PAYOUTS_ENABLED` in the environment was a second required gate.
      // It is not: `mark_redemption_paid` checks `config_bool` and nothing
      // else, and the env var is declared in src/lib/env.ts and read by no
      // code at all. The old name asserted a safety property this system does
      // not have, which is worse than having no test.
      await setConfigAs(tx, admin.id, { payouts_enabled: 'true' })
      expect(await configValue(tx, 'payouts_enabled')).toBe('true')
      const { rows } = await tx.query<{ v: boolean }>(
        `select public.config_bool('payouts_enabled') as v`,
      )
      expect(rows[0]!.v).toBe(true)
    })
  })
})
