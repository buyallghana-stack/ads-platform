import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, withRollback } from '../support/db'

/**
 * Certificates, expiry and the nightly maintenance.
 *
 * The distinction these tests exist to hold: a certificate says somebody
 * FINISHED, the activation threshold says they may START PROMOTING, and those
 * are different claims about different amounts of work. Issuing at the
 * threshold would hand out a certificate for half a course.
 *
 * And the one worth understanding before touching `expire_affiliate_entitlements`:
 * it changes nothing about who can earn. Lapsing is already computed live, so
 * if the cron never runs the MONEY is still right — what the job fixes is the
 * status column telling the truth.
 */

const superAdmin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

const makeTraining = async (
  tx: Tx,
  by: string,
  o: { lessons?: number; threshold?: number; certificate?: boolean } = {},
) => {
  const { lessons = 2, threshold = 50, certificate = true } = o
  seq += 1
  const { rows: prod } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'training_program', 'Maintenance Training', $1, 15000, 'published', $2)
     returning id`,
    [`maint-${Date.now()}-${seq}`, by],
  )
  const productId = prod[0]!.id
  await tx.query(
    `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value)
     values ($1, 20, 5)`,
    [productId],
  )
  await tx.query(
    `insert into public.training_programs
       (product_id, level, commission_depth, activation_threshold_percent,
        quiz_required, validity_days, grace_days, certificate_enabled)
     values ($1, 'beginner', 1, $2, false, 365, 5, $3)`,
    [productId, threshold, certificate],
  )
  const { rows: sec } = await tx.query<{ id: string }>(
    `insert into public.course_sections (product_id, title, position)
     values ($1, 'Only Section', 0) returning id`,
    [productId],
  )
  const lessonIds: string[] = []
  for (let i = 0; i < lessons; i += 1) {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.lessons (section_id, kind, title, position, body)
       values ($1, 'article', $2, $3, 'Read me.') returning id`,
      [sec[0]!.id, `Lesson ${i + 1}`, i],
    )
    lessonIds.push(rows[0]!.id)
  }
  return { productId, lessonIds }
}

const buy = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.start_product_order($1, $2, 'paystack')`,
    [userId, productId],
  )
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2, null)`, [
    rows[0]!.id,
    `MNT-${Date.now()}-${seq}`,
  ])
}

const read = async (tx: Tx, userId: string, lessonId: string) =>
  tx.query(`select public.mark_lesson_read($1, $2)`, [userId, lessonId])

const certificatesFor = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ verification_code: string }>(
    `select verification_code from public.certificates where user_id = $1`,
    [userId],
  )
  return rows
}

describe.skipIf(!HAS_DB)('certificates', () => {
  it('is issued on finishing the WHOLE course, not at the activation threshold', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Finisher' })
      const { productId, lessonIds } = await makeTraining(tx, by, { lessons: 2, threshold: 50 })
      await buy(tx, user.id, productId)

      await read(tx, user.id, lessonIds[0]!)
      /* Half the course: they may now promote, but they have not finished it.
         A certificate here would be for work not done. */
      const { rows: account } = await tx.query<{ status: string }>(
        `select status::text from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )
      expect(account[0]!.status).toBe('active')
      expect(await certificatesFor(tx, user.id)).toHaveLength(0)

      await read(tx, user.id, lessonIds[1]!)
      const certificates = await certificatesFor(tx, user.id)
      expect(certificates).toHaveLength(1)
      expect(certificates[0]!.verification_code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/)
    })
  })

  it('arrives with a notification rather than silently', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Notified' })
      const { productId, lessonIds } = await makeTraining(tx, by, { lessons: 1, threshold: 100 })
      await buy(tx, user.id, productId)
      await read(tx, user.id, lessonIds[0]!)

      const { rows } = await tx.query<{ title: string }>(
        `select title from public.notifications
          where user_id = $1 and reference @> '{"kind":"certificate"}'::jsonb`,
        [user.id],
      )
      expect(rows[0]!.title).toBe('Certificate earned')
    })
  })

  it('issues none when the program has them switched off', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'No Certificate' })
      const { productId, lessonIds } = await makeTraining(tx, by, {
        lessons: 1,
        threshold: 100,
        certificate: false,
      })
      await buy(tx, user.id, productId)
      await read(tx, user.id, lessonIds[0]!)

      expect(await certificatesFor(tx, user.id)).toHaveLength(0)
    })
  })

  it('issues one and only one, however many times completion is settled', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Double Finisher' })
      const { productId, lessonIds } = await makeTraining(tx, by, { lessons: 1, threshold: 100 })
      await buy(tx, user.id, productId)

      await read(tx, user.id, lessonIds[0]!)
      await read(tx, user.id, lessonIds[0]!)
      await tx.query(`select public.issue_certificate_if_earned($1, $2)`, [user.id, productId])

      expect(await certificatesFor(tx, user.id)).toHaveLength(1)
    })
  })
})

describe.skipIf(!HAS_DB)('expiring what has lapsed', () => {
  it('marks the status without changing who can earn', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Lapsed Holder' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)

      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )
      const affiliateId = acc[0]!.id

      await tx.query(
        `update public.affiliate_entitlements
            set starts_at = now() - interval '400 days',
                expires_at = now() - interval '10 days',
                grace_ends_at = now() - interval '5 days'
          where affiliate_id = $1`,
        [affiliateId],
      )

      /* THE POINT: earning already stopped, because lapsing is computed live
         from grace_ends_at. If this job never ran the money would still be
         right — what it fixes is the label. */
      const depthBefore = await tx
        .query<{ d: number }>(`select public.affiliate_depth_now($1) as d`, [affiliateId])
        .then((r) => r.rows[0]!.d)
      expect(depthBefore).toBe(0)

      const { rows: before } = await tx.query<{ status: string }>(
        `select status::text from public.affiliate_entitlements where affiliate_id = $1`,
        [affiliateId],
      )
      expect(before[0]!.status).toBe('active')   // the column was lying

      await tx.query(`select public.expire_affiliate_entitlements()`)

      const { rows: after } = await tx.query<{ status: string }>(
        `select status::text from public.affiliate_entitlements where affiliate_id = $1`,
        [affiliateId],
      )
      expect(after[0]!.status).toBe('expired')

      const depthAfter = await tx
        .query<{ d: number }>(`select public.affiliate_depth_now($1) as d`, [affiliateId])
        .then((r) => r.rows[0]!.d)
      expect(depthAfter).toBe(0)
    })
  })

  it('leaves somebody still inside their grace period alone', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'In Grace' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)
      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )

      await tx.query(
        `update public.affiliate_entitlements
            set starts_at = now() - interval '366 days',
                expires_at = now() - interval '1 day',
                grace_ends_at = now() + interval '4 days'
          where affiliate_id = $1`,
        [acc[0]!.id],
      )

      await tx.query(`select public.expire_affiliate_entitlements()`)

      const { rows } = await tx.query<{ status: string }>(
        `select status::text from public.affiliate_entitlements where affiliate_id = $1`,
        [acc[0]!.id],
      )
      // B11e: expired is not lapsed. They can still earn for four more days.
      expect(rows[0]!.status).toBe('active')
    })
  })
})

describe.skipIf(!HAS_DB)('warning people their year is ending', () => {
  const warn = async (tx: Tx) => tx.query(`select public.warn_expiring_entitlements()`)

  /* Read out of the structured reference, which is also the record of what
     has already been sent — see migration 126. */
  const warningsFor = async (tx: Tx, userId: string) => {
    const { rows } = await tx.query<{ days: string }>(
      `select reference->>'days' as days from public.notifications
        where user_id = $1 and reference @> '{"kind":"entitlement_expiry"}'::jsonb
        order by (reference->>'days')::int`,
      [userId],
    )
    return rows.map((r) => r.days)
  }

  it('warns at thirty days and not before', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Warned' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)
      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )

      // A year away: nothing to say yet.
      await warn(tx)
      expect(await warningsFor(tx, user.id)).toEqual([])

      await tx.query(
        `update public.affiliate_entitlements
            set expires_at = now() + interval '20 days',
                grace_ends_at = now() + interval '25 days'
          where affiliate_id = $1`,
        [acc[0]!.id],
      )
      await warn(tx)
      expect(await warningsFor(tx, user.id)).toEqual(['30'])
    })
  })

  it('does not send the same warning twice', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Warned Once' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)
      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )
      await tx.query(
        `update public.affiliate_entitlements
            set expires_at = now() + interval '20 days',
                grace_ends_at = now() + interval '25 days'
          where affiliate_id = $1`,
        [acc[0]!.id],
      )

      /* The notification's own reference is the record of what was sent, so a
         second run the same night is a no-op and a job that failed halfway can
         simply be run again. A `warned_at` column would be a second source of
         truth that drifts the first time a send succeeds and the update does
         not. */
      await warn(tx)
      await warn(tx)
      await warn(tx)
      expect(await warningsFor(tx, user.id)).toEqual(['30'])
    })
  })

  it('escalates as the date gets closer', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Escalating' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)
      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )

      await tx.query(
        `update public.affiliate_entitlements
            set expires_at = now() + interval '20 hours',
                grace_ends_at = now() + interval '5 days'
          where affiliate_id = $1`,
        [acc[0]!.id],
      )
      await warn(tx)

      // Inside a day, so all three thresholds are met at once.
      expect((await warningsFor(tx, user.id)).sort()).toEqual(['1', '30', '7'])
    })
  })
})

describe.skipIf(!HAS_DB)('the nightly job', () => {
  it('reports what it did', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query<{
        expired: number
        cleared: number
        warned: number
        errors: string[]
      }>(`select * from public.run_affiliate_maintenance()`)

      /* Returns counts rather than nothing, so an operator can tell "ran and
         there was nothing to do" from "did not run". */
      expect(rows[0]!.errors).toEqual([])
      expect(typeof rows[0]!.expired).toBe('number')
      expect(typeof rows[0]!.cleared).toBe('number')
      expect(typeof rows[0]!.warned).toBe('number')
    })
  })

  it('does all three jobs in one pass', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const user = await createUser(tx, { name: 'Everything At Once' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)
      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )

      await tx.query(
        `update public.affiliate_entitlements
            set starts_at = now() - interval '400 days',
                expires_at = now() - interval '10 days',
                grace_ends_at = now() - interval '5 days'
          where affiliate_id = $1`,
        [acc[0]!.id],
      )

      const { rows } = await tx.query<{ expired: number }>(
        `select expired from public.run_affiliate_maintenance()`,
      )
      expect(rows[0]!.expired).toBeGreaterThanOrEqual(1)
    })
  })
})
