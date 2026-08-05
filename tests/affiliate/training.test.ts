import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Phase 2, step 4: training, affiliate accounts and activation.
 *
 * The assertions worth having here are the ones about WHEN somebody may earn
 * money, because every one of them is a rule the operator chose and none of
 * them is visible from the schema alone:
 *
 *  - buying is not activating (B9)
 *  - activation only ever switches ON, so editing the curriculum cannot
 *    un-make an affiliate
 *  - the year runs from PURCHASE (B11a), and it takes away the right to
 *    promote WITHOUT taking away the course (B11)
 *  - a third level is unexpressible, and two affiliates cannot be each other's
 *    upline
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

/** A training product with a program, some sections and `lessons` lessons. */
const makeTraining = async (
  tx: Tx,
  by: string,
  o: { level?: string; depth?: number; threshold?: number; lessons?: number; validity?: number; grace?: number; quiz?: boolean } = {},
) => {
  const {
    level = 'professional',
    depth = 2,
    threshold = 50,
    lessons = 4,
    validity = 365,
    grace = 5,
    quiz = true,
  } = o
  seq += 1

  const { rows: prod } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'training_program', 'Training', $1, 40000, 'published', $2) returning id`,
    [`training-${Date.now()}-${seq}`, by],
  )
  const productId = prod[0]!.id

  const { rows: tp } = await tx.query<{ id: string }>(
    `insert into public.training_programs
       (product_id, level, commission_depth, activation_threshold_percent,
        lesson_pass_percent, quiz_required, validity_days, grace_days)
     values ($1, $2::public.affiliate_tier, $3, $4, 90, $5, $6, $7) returning id`,
    [productId, level, depth, threshold, quiz, validity, grace],
  )

  const { rows: sec } = await tx.query<{ id: string }>(
    `insert into public.course_sections (product_id, title, position)
     values ($1, 'Only Section', 0) returning id`,
    [productId],
  )

  const lessonIds: string[] = []
  for (let i = 0; i < lessons; i += 1) {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.lessons (section_id, title, position, duration_seconds)
       values ($1, $2, $3, 600) returning id`,
      [sec[0]!.id, `Lesson ${i + 1}`, i],
    )
    lessonIds.push(rows[0]!.id)
  }

  return { productId, trainingId: tp[0]!.id, lessonIds }
}

const buy = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.start_product_order($1, $2, 'paystack')`,
    [userId, productId],
  )
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2)`, [
    rows[0]!.id,
    `TRAIN-${Date.now()}-${seq}`,
  ])
  return rows[0]!.id
}

const accountOf = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{
    id: string
    status: string
    affiliate_code: string
    activated_at: string | null
  }>(
    `select id, status::text, affiliate_code, activated_at::text
       from public.affiliate_accounts where user_id = $1`,
    [userId],
  )
  return rows[0] ?? null
}

const complete = async (tx: Tx, userId: string, lessonId: string) => {
  const { rows } = await tx.query<{ pct: number }>(
    `select public.record_lesson_progress($1, $2, 600, 100, true) as pct`,
    [userId, lessonId],
  )
  return rows[0]!.pct
}

describe.skipIf(!HAS_DB)('buying training', () => {
  it('creates a PENDING affiliate account, not an active one', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'New Affiliate' })
      const { productId } = await makeTraining(tx, by, { threshold: 50 })

      expect(await accountOf(tx, user.id)).toBeNull()
      await buy(tx, user.id, productId)

      const account = await accountOf(tx, user.id)
      /* B9: buying is not activating. Paying gets you the course; completing
         the Owner's share of it gets you the right to promote. */
      expect(account?.status).toBe('pending')
      expect(account?.activated_at).toBeNull()
      expect(account?.affiliate_code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/)
    })
  })

  it('cannot promote anything while pending', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Not Yet' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)
      const account = await accountOf(tx, user.id)

      const { rows } = await tx.query<{ d: number }>(
        `select public.affiliate_depth_now($1) as d`,
        [account!.id],
      )
      expect(rows[0]!.d).toBe(0)
    })
  })

  it('activates on purchase when the threshold is zero', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Instant' })
      const { productId } = await makeTraining(tx, by, { threshold: 0 })
      await buy(tx, user.id, productId)
      // A configuration the Owner is entitled to choose.
      expect((await accountOf(tx, user.id))?.status).toBe('active')
    })
  })
})

describe.skipIf(!HAS_DB)('activation', () => {
  it('switches on once the threshold share of lessons is complete', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Learner' })
      const { productId, lessonIds } = await makeTraining(tx, by, { threshold: 50, lessons: 4 })
      await buy(tx, user.id, productId)

      expect(await complete(tx, user.id, lessonIds[0]!)).toBe(25)
      expect((await accountOf(tx, user.id))?.status).toBe('pending')

      expect(await complete(tx, user.id, lessonIds[1]!)).toBe(50)
      expect((await accountOf(tx, user.id))?.status).toBe('active')
    })
  })

  it('counts a lesson only when watched AND its quiz is passed', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Skipper' })
      const { productId, lessonIds } = await makeTraining(tx, by, {
        threshold: 50,
        lessons: 2,
        quiz: true,
      })
      await buy(tx, user.id, productId)

      /* B10 wants BOTH, and since migration 119 that means a real quiz rather
         than a boolean the caller asserts. The old shape of this test passed
         `quiz_passed: false` to a lesson with no quiz attached — which under
         the old rule made the lesson permanently uncompletable unless a caller
         passed `true`, i.e. unless something lied. */
      const { rows: q } = await tx.query<{ id: string }>(
        `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent)
         values ($1, 'Check', 30, 70) returning id`,
        [lessonIds[0]!],
      )
      const { rows: question } = await tx.query<{ id: string }>(
        `insert into public.quiz_questions (quiz_id, position, prompt)
         values ($1, 0, 'Did you watch?') returning id`,
        [q[0]!.id],
      )
      const { rows: right } = await tx.query<{ id: string }>(
        `insert into public.quiz_options (question_id, position, body, is_correct)
         values ($1, 0, 'Yes', true) returning id`,
        [question[0]!.id],
      )
      await tx.query(
        `insert into public.quiz_options (question_id, position, body, is_correct)
         values ($1, 1, 'No', false)`,
        [question[0]!.id],
      )

      // Watched to the end, questions untouched.
      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, null)`, [
        user.id,
        lessonIds[0]!,
      ])
      expect((await accountOf(tx, user.id))?.status).toBe('pending')

      // …and now answered.
      await tx.query(
        `select public.submit_quiz_attempt($1, $2, $3::jsonb)`,
        [user.id, q[0]!.id, JSON.stringify({ [question[0]!.id]: right[0]!.id })],
      )
      expect((await accountOf(tx, user.id))?.status).toBe('active')
    })
  })

  it('never deactivates when the curriculum grows', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Qualified' })
      const { productId, lessonIds } = await makeTraining(tx, by, { threshold: 50, lessons: 2 })
      await buy(tx, user.id, productId)
      await complete(tx, user.id, lessonIds[0]!)
      expect((await accountOf(tx, user.id))?.status).toBe('active')

      /* The Owner publishes six more lessons. Completion drops from 50% to
         12.5% — and an affiliate who already qualified must NOT lose the
         right to earn because of an edit to the course. */
      const { rows: sec } = await tx.query<{ id: string }>(
        `select id from public.course_sections where product_id = $1 limit 1`,
        [productId],
      )
      for (let i = 0; i < 6; i += 1) {
        await tx.query(
          `insert into public.lessons (section_id, title, position) values ($1, $2, $3)`,
          [sec[0]!.id, `Extra ${i}`, 10 + i],
        )
      }

      expect(await tx
        .query<{ p: number }>(`select public.training_completion_percent($1, $2) as p`, [
          user.id,
          productId,
        ])
        .then((r) => r.rows[0]!.p)).toBeLessThan(50)
      expect((await accountOf(tx, user.id))?.status).toBe('active')
    })
  })

  it('does not let progress run backwards', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Scrubber' })
      const { productId, lessonIds } = await makeTraining(tx, by, { threshold: 100, lessons: 1 })
      await buy(tx, user.id, productId)
      await complete(tx, user.id, lessonIds[0]!)

      // Scrubbing back to the start must not un-complete the lesson.
      await tx.query(`select public.record_lesson_progress($1, $2, 5, 1, false)`, [
        user.id,
        lessonIds[0]!,
      ])
      const { rows } = await tx.query<{ pct: number; done: string | null }>(
        `select watched_percent as pct, completed_at::text as done
           from public.lesson_progress where user_id = $1 and lesson_id = $2`,
        [user.id, lessonIds[0]!],
      )
      expect(rows[0]!.pct).toBe(100)
      expect(rows[0]!.done).not.toBeNull()
    })
  })

  it('leaves a suspended account suspended', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Suspended' })
      const { productId, lessonIds } = await makeTraining(tx, by, { threshold: 50, lessons: 2 })
      await buy(tx, user.id, productId)
      await tx.query(`update public.affiliate_accounts set status = 'suspended' where user_id = $1`, [
        user.id,
      ])

      // A suspension is a decision by a human; finishing a video does not undo it.
      await complete(tx, user.id, lessonIds[0]!)
      expect((await accountOf(tx, user.id))?.status).toBe('suspended')
    })
  })
})

describe.skipIf(!HAS_DB)('the right to promote expires, the course does not', () => {
  it('keeps the course permanently but stops the earning', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Lapsed' })
      const { productId, lessonIds } = await makeTraining(tx, by, { threshold: 50, lessons: 2 })
      await buy(tx, user.id, productId)
      await complete(tx, user.id, lessonIds[0]!)
      const account = await accountOf(tx, user.id)

      const depthBefore = await tx
        .query<{ d: number }>(`select public.affiliate_depth_now($1) as d`, [account!.id])
        .then((r) => r.rows[0]!.d)
      expect(depthBefore).toBe(2)

      /* Age the whole entitlement, START INCLUDED. Moving only the expiry
         backwards is refused by `affiliate_entitlement_dates_ordered`, and
         rightly so — an entitlement that expires before it begins is not a
         state the product can reach, so the test must not fabricate one. */
      await tx.query(
        `update public.affiliate_entitlements
            set starts_at = now() - interval '400 days',
                expires_at = now() - interval '10 days',
                grace_ends_at = now() - interval '5 days'
          where affiliate_id = $1`,
        [account!.id],
      )

      const depthAfter = await tx
        .query<{ d: number }>(`select public.affiliate_depth_now($1) as d`, [account!.id])
        .then((r) => r.rows[0]!.d)
      expect(depthAfter).toBe(0)

      /* THE DISTINCTION THIS WHOLE STEP TURNS ON. Migration 110's own note got
         this wrong: it said step 4 should stamp an expiry on the CONTENT
         entitlement. The operator's rule is the opposite — somebody keeps the
         course they paid for permanently, and it is only the right to promote
         that lapses. */
      const { rows } = await tx.query<{ ok: boolean }>(
        `select public.has_entitlement($1, $2) as ok`,
        [user.id, productId],
      )
      expect(rows[0]!.ok).toBe(true)
    })
  })

  it('still earns during the grace period', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'In Grace' })
      const { productId, lessonIds } = await makeTraining(tx, by, {
        threshold: 50,
        lessons: 2,
        grace: 5,
      })
      await buy(tx, user.id, productId)
      await complete(tx, user.id, lessonIds[0]!)
      const account = await accountOf(tx, user.id)

      // Bought a year and a day ago: expired yesterday, grace runs four more
      // days (B11e). Aged from the start so the date ordering stays possible.
      await tx.query(
        `update public.affiliate_entitlements
            set starts_at = now() - interval '366 days',
                expires_at = now() - interval '1 day',
                grace_ends_at = now() + interval '4 days'
          where affiliate_id = $1`,
        [account!.id],
      )

      const { rows } = await tx.query<{ d: number }>(
        `select public.affiliate_depth_now($1) as d`,
        [account!.id],
      )
      expect(rows[0]!.d).toBe(2)
    })
  })

  it('dates the year from the purchase, not from activation', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Parker' })
      const { productId } = await makeTraining(tx, by, { validity: 365, grace: 5 })
      await buy(tx, user.id, productId)
      const account = await accountOf(tx, user.id)

      /* B11a. Activation-dated would let somebody park an unstarted
         entitlement indefinitely and start the clock whenever it suited. */
      const { rows } = await tx.query<{ days: number; grace_days: number }>(
        `select round(extract(epoch from (expires_at - starts_at)) / 86400)::int as days,
                round(extract(epoch from (grace_ends_at - expires_at)) / 86400)::int as grace_days
           from public.affiliate_entitlements where affiliate_id = $1`,
        [account!.id],
      )
      expect([rows[0]!.days, rows[0]!.grace_days]).toEqual([365, 5])
    })
  })
})

describe.skipIf(!HAS_DB)('the tree is one hop deep', () => {
  it('refuses an affiliate as their own upline', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Self Parent' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)
      const account = await accountOf(tx, user.id)

      const message = await expectRejection(tx, () =>
        tx.query(`update public.affiliate_accounts set parent_affiliate_id = $1 where id = $1`, [
          account!.id,
        ]),
      )
      expect(message).toMatch(/own upline|affiliate_not_own_parent/i)
    })
  })

  it('refuses two affiliates being each other\'s upline', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const a = await createUser(tx, { name: 'Alpha' })
      const b = await createUser(tx, { name: 'Beta' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, a.id, productId)
      await buy(tx, b.id, productId)
      const accountA = await accountOf(tx, a.id)
      const accountB = await accountOf(tx, b.id)

      await tx.query(`update public.affiliate_accounts set parent_affiliate_id = $2 where id = $1`, [
        accountB!.id,
        accountA!.id,
      ])

      /* Reachable in practice: A recruits B, then B's link sells A their
         training. Without the guard A becomes their own second-level affiliate
         and pays themselves an override forever. */
      const message = await expectRejection(tx, () =>
        tx.query(`update public.affiliate_accounts set parent_affiliate_id = $2 where id = $1`, [
          accountA!.id,
          accountB!.id,
        ]),
      )
      expect(message).toMatch(/each other's upline/i)
    })
  })
})

describe.skipIf(!HAS_DB)('what a tier buys', () => {
  it('gives Beginner one level and Professional two', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const beginner = await createUser(tx, { name: 'Beginner Holder' })
      const pro = await createUser(tx, { name: 'Pro Holder' })

      const b = await makeTraining(tx, by, { level: 'beginner', depth: 1, threshold: 0 })
      const p = await makeTraining(tx, by, { level: 'professional', depth: 2, threshold: 0 })

      await buy(tx, beginner.id, b.productId)
      await buy(tx, pro.id, p.productId)

      const beginnerDepth = await tx
        .query<{ d: number }>(`select public.affiliate_depth_now($1) as d`, [
          (await accountOf(tx, beginner.id))!.id,
        ])
        .then((r) => r.rows[0]!.d)
      const proDepth = await tx
        .query<{ d: number }>(`select public.affiliate_depth_now($1) as d`, [
          (await accountOf(tx, pro.id))!.id,
        ])
        .then((r) => r.rows[0]!.d)

      expect([beginnerDepth, proDepth]).toEqual([1, 2])
    })
  })

  it('refuses a level and a depth that disagree', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      seq += 1
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
         values ('course', 'training_program', 'Mismatch', $1, 1000, 'published', $2) returning id`,
        [`mismatch-${Date.now()}-${seq}`, by],
      )
      /* Beginner unlocking two levels would quietly pay an override to
         somebody who bought the cheaper tier. */
      const message = await expectRejection(tx, () =>
        tx.query(
          `insert into public.training_programs (product_id, level, commission_depth)
           values ($1, 'beginner', 2)`,
          [rows[0]!.id],
        ),
      )
      expect(message).toMatch(/training_depth_matches_level/i)
    })
  })

  it('refuses training settings on a product that is not training', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      seq += 1
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
         values ('course', 'vendor_product', 'Just A Course', $1, 1000, 'published', $2) returning id`,
        [`notraining-${Date.now()}-${seq}`, by],
      )
      const message = await expectRejection(tx, () =>
        tx.query(
          `insert into public.training_programs (product_id, level, commission_depth)
           values ($1, 'beginner', 1)`,
          [rows[0]!.id],
        ),
      )
      expect(message).toMatch(/only a training_program product/i)
    })
  })
})
