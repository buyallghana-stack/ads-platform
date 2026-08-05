import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, withRollback } from '../support/db'

/**
 * The two reads the Phase 2 screens are built on: `affiliate_dashboard` and
 * `lesson_for_learner`.
 *
 * These are reads, so nothing here is about money moving. What they ARE about
 * is two things a screen can get wrong in ways that cost real money:
 *
 *  1. The dashboard must report the SAME balance the payout path will honour.
 *     If it computed its own, a user would be shown a withdrawable figure that
 *     `request_commission_payout` then refuses, and both numbers would be
 *     real. That is an unwinnable support conversation.
 *
 *  2. `lesson_for_learner` must never return the answer key, and must refuse
 *     an article the caller has not bought. An article's whole content is
 *     inline text — there is no signed URL standing between it and the
 *     reader, so this function IS the lock.
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
  o: { threshold?: number; lessons?: number } = {},
) => {
  const { threshold = 50, lessons = 4 } = o
  seq += 1

  const { rows: prod } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'training_program', 'Training', $1, 40000, 'published', $2) returning id`,
    [`screen-${Date.now()}-${seq}`, by],
  )
  const productId = prod[0]!.id

  await tx.query(
    `insert into public.training_programs
       (product_id, level, commission_depth, activation_threshold_percent,
        lesson_pass_percent, quiz_required, validity_days, grace_days)
     values ($1, 'professional', 2, $2, 90, true, 365, 5)`,
    [productId, threshold],
  )
  await tx.query(
    `insert into public.affiliate_programs (product_id, l1_rate_value, l2_rate_value)
     values ($1, 20, 5)`,
    [productId],
  )

  const { rows: sec } = await tx.query<{ id: string }>(
    `insert into public.course_sections (product_id, title, position)
     values ($1, 'Only Section', 0) returning id`,
    [productId],
  )

  const lessonIds: string[] = []
  for (let i = 0; i < lessons; i += 1) {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.lessons (section_id, title, position, kind, duration_seconds, storage_path)
       values ($1, $2, $3, 'video', 600, 'x/y.mp4') returning id`,
      [sec[0]!.id, `Lesson ${i + 1}`, i],
    )
    lessonIds.push(rows[0]!.id)
  }

  return { productId, sectionId: sec[0]!.id, lessonIds }
}

const buy = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.start_product_order($1, $2, 'paystack')`,
    [userId, productId],
  )
  seq += 1
  await tx.query(`select public.confirm_product_order($1, $2)`, [
    rows[0]!.id,
    `SCREEN-${Date.now()}-${seq}`,
  ])
  return rows[0]!.id
}

const dash = async (tx: Tx, userId: string) => {
  const { rows } = await tx.query<{ d: Record<string, unknown> }>(
    `select public.affiliate_dashboard($1) as d`,
    [userId],
  )
  return rows[0]!.d
}

describe.skipIf(!HAS_DB)('affiliate_dashboard', () => {
  it('reports `none` for somebody who has never bought training', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx, { name: 'Just Browsing' })
      const d = await dash(tx, user.id)

      // Not an error. Everyone can reach this screen — the mode switch is
      // visible to every signed-in user on purpose.
      expect(d.state).toBe('none')
      expect(Array.isArray(d.training_offers)).toBe(true)
    })
  })

  it('reports `pending` after buying, with the course progress to show', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'New Affiliate' })
      const { productId } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)

      const d = await dash(tx, user.id)

      // B9: buying is not activating.
      expect(d.state).toBe('pending')
      // The pending screen leads with progress, so the progress must be there.
      expect((d.training as unknown[]).length).toBe(1)
      expect((d.training as { percent: number }[])[0]!.percent).toBe(0)
      expect((d.training as { threshold: number }[])[0]!.threshold).toBe(50)
    })
  })

  it('reports `active` once the threshold is crossed', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Working Affiliate' })
      const { productId, lessonIds } = await makeTraining(tx, by, { lessons: 4, threshold: 50 })
      await buy(tx, user.id, productId)

      for (const id of lessonIds.slice(0, 2)) {
        await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, true)`, [
          user.id,
          id,
        ])
      }

      const d = await dash(tx, user.id)
      expect(d.state).toBe('active')
      expect(d.depth).toBe(2)
      expect(d.tier).toBe('professional')
      // The screen prints this next to a withdraw button, so it must be the
      // real code and not a placeholder.
      expect(typeof d.code).toBe('string')
      expect((d.code as string).length).toBeGreaterThan(0)
    })
  })

  it('reports the SAME balance the payout path uses', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Earner' })
      const { productId, lessonIds } = await makeTraining(tx, by, { lessons: 2, threshold: 50 })
      await buy(tx, user.id, productId)
      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, true)`, [
        user.id,
        lessonIds[0],
      ])

      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )
      const affiliateId = acc[0]!.id

      /* An ADJUSTMENT, not a credit. `commission_credit_shape` requires a
         credit to reference a real conversion — a credit is always FOR
         something — and faking one here would be inventing a sale that did
         not happen just to make a read test pass. An adjustment carries a
         written reason and lands in the same balance. */
      await tx.query(
        `insert into public.commission_ledger
           (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
         values ($1, 'adjustment', 12345, 'cleared', 'balance read test', $2)`,
        [affiliateId, `screen-adjust-${Date.now()}`],
      )

      const d = await dash(tx, user.id)
      const { rows: fn } = await tx.query<{ b: string }>(
        `select public.affiliate_balance_minor($1)::text as b`,
        [affiliateId],
      )

      // The whole point: one definition of balance, not two.
      expect(String(d.balance_minor)).toBe(fn[0]!.b)
      expect(Number(d.balance_minor)).toBe(12345)
    })
  })

  it('never reports a balance larger than what was ever earned', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Adjusted' })
      const { productId, lessonIds } = await makeTraining(tx, by, { lessons: 2, threshold: 50 })
      await buy(tx, user.id, productId)
      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, true)`, [
        user.id,
        lessonIds[0],
      ])

      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )

      await tx.query(
        `insert into public.commission_ledger
           (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
         values ($1, 'adjustment', 24800, 'cleared', 'goodwill', $2)`,
        [acc[0]!.id, `consistency-${Date.now()}`],
      )

      const d = await dash(tx, user.id)

      /*
        Caught by looking at the built screen: the dashboard showed a balance
        of GHS 248.00 above "Earned all time GHS 0.00", because `earned`
        counted only credits and an adjustment is not a credit. Both figures
        were right by their own definition and together they were nonsense —
        a balance cannot exceed what was ever earned.

        The property, not the number: the three lifetime figures must
        reconcile to the balance.
      */
      expect(Number(d.earned_minor)).toBeGreaterThanOrEqual(Number(d.balance_minor))
      expect(
        Number(d.earned_minor) - Number(d.reversed_minor) - Number(d.paid_minor),
      ).toBe(Number(d.balance_minor))
    })
  })

  it('counts an adjustment AGAINST the affiliate as reversed, not as negative earnings', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Corrected' })
      const { productId, lessonIds } = await makeTraining(tx, by, { lessons: 2, threshold: 50 })
      await buy(tx, user.id, productId)
      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, true)`, [
        user.id,
        lessonIds[0],
      ])

      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )

      await tx.query(
        `insert into public.commission_ledger
           (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
         values ($1, 'adjustment', -5000, 'cleared', 'correction', $2)`,
        [acc[0]!.id, `clawback-${Date.now()}`],
      )

      const d = await dash(tx, user.id)

      // A clawback must not hide inside a figure labelled "earned" — people
      // screenshot lifetime totals and compare them.
      expect(Number(d.earned_minor)).toBe(0)
      expect(Number(d.reversed_minor)).toBe(5000)
    })
  })

  it('flips the sign on reversals so the screen never prints two minuses', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Refunded' })
      const { productId, lessonIds } = await makeTraining(tx, by, { lessons: 2, threshold: 50 })
      await buy(tx, user.id, productId)
      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, true)`, [
        user.id,
        lessonIds[0],
      ])

      const { rows: acc } = await tx.query<{ id: string }>(
        `select id from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )

      await tx.query(
        `insert into public.commission_ledger
           (affiliate_id, level, entry_type, amount_minor, status, reason, idempotency_key)
         values ($1, 1, 'reversal', -4000, 'cleared', 'test refund', $2)`,
        [acc[0]!.id, `screen-reversal-${Date.now()}`],
      )

      const d = await dash(tx, user.id)
      // Stored negative, reported positive — the UI prints "GHS 40.00 was
      // taken back", not "GHS -40.00 was taken back".
      expect(Number(d.reversed_minor)).toBe(4000)
      expect(Number(d.balance_minor)).toBe(-4000)
    })
  })
})

describe.skipIf(!HAS_DB)('lesson_for_learner', () => {
  it('refuses a lesson the caller has not bought', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const stranger = await createUser(tx, { name: 'Stranger' })
      const { lessonIds } = await makeTraining(tx, by)

      const { rows } = await tx.query<{ p: { ok: boolean; reason: string } }>(
        `select public.lesson_for_learner($1, $2) as p`,
        [stranger.id, lessonIds[0]],
      )

      expect(rows[0]!.p.ok).toBe(false)
      expect(rows[0]!.p.reason).toBe('locked')
    })
  })

  it('opens a PREVIEW lesson to somebody who has not bought', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const stranger = await createUser(tx, { name: 'Sampler' })
      const { lessonIds } = await makeTraining(tx, by)
      await tx.query(`update public.lessons set is_preview = true where id = $1`, [lessonIds[0]])

      const { rows } = await tx.query<{ p: { ok: boolean } }>(
        `select public.lesson_for_learner($1, $2) as p`,
        [stranger.id, lessonIds[0]],
      )

      // This is what makes "watch the first one free" possible without a
      // second code path.
      expect(rows[0]!.p.ok).toBe(true)
    })
  })

  it('never returns the answer key', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Learner' })
      const { productId, lessonIds } = await makeTraining(tx, by)
      await buy(tx, user.id, productId)

      const { rows: quiz } = await tx.query<{ id: string }>(
        `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent, position)
         values ($1, 'Checkpoint', 120, 60, 0) returning id`,
        [lessonIds[0]],
      )
      const { rows: question } = await tx.query<{ id: string }>(
        `insert into public.quiz_questions (quiz_id, position, prompt)
         values ($1, 0, 'Which one?') returning id`,
        [quiz[0]!.id],
      )
      await tx.query(
        `insert into public.quiz_options (question_id, position, body, is_correct)
         values ($1, 0, 'Right', true), ($1, 1, 'Wrong', false)`,
        [question[0]!.id],
      )

      const { rows } = await tx.query<{ p: Record<string, unknown> }>(
        `select public.lesson_for_learner($1, $2) as p`,
        [user.id, lessonIds[0]],
      )

      const serialised = JSON.stringify(rows[0]!.p)
      // Passing a quiz completes a lesson, completed lessons make an
      // affiliate, and affiliates earn real money. A browser-marked quiz
      // would be a browser-granted right to earn.
      expect(serialised).not.toContain('is_correct')

      const quizzes = rows[0]!.p.quizzes as { at_seconds: number; questions: unknown[] }[]
      expect(quizzes.length).toBe(1)
      expect(quizzes[0]!.at_seconds).toBe(120)
      expect(quizzes[0]!.questions.length).toBe(1)
    })
  })

  it('withholds article text from a non-buyer, because there is no signed URL to stop them', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const stranger = await createUser(tx, { name: 'Reader' })
      const { sectionId } = await makeTraining(tx, by)

      const { rows: article } = await tx.query<{ id: string }>(
        `insert into public.lessons (section_id, title, position, kind, body)
         values ($1, 'Paid Article', 99, 'article', 'The whole paid text.') returning id`,
        [sectionId],
      )

      const { rows } = await tx.query<{ p: { ok: boolean } }>(
        `select public.lesson_for_learner($1, $2) as p`,
        [stranger.id, article[0]!.id],
      )

      expect(rows[0]!.p.ok).toBe(false)
      expect(JSON.stringify(rows[0]!.p)).not.toContain('The whole paid text.')
    })
  })
})
