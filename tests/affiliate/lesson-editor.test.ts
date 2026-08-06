import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * The two functions the lesson editor is built on: `admin_lesson_detail` and
 * `admin_delete_quiz`.
 *
 * The assertion that matters most is the pair: the ADMIN read must carry the
 * answer key and the LEARNER read must not. They are separate functions rather
 * than one with a flag precisely so that property can be tested as a property
 * — a boolean argument would make "did anyone pass the wrong value" the real
 * question, and no test can answer that for every future caller.
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

const makeLesson = async (tx: Tx, by: string, kind = 'video') => {
  seq += 1
  const { rows: prod } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'training_program', 'Editor', $1, 15000, 'draft', $2) returning id`,
    [`editor-${Date.now()}-${seq}`, by],
  )
  const { rows: sec } = await tx.query<{ id: string }>(
    `insert into public.course_sections (product_id, title, position)
     values ($1, 'Only Section', 0) returning id`,
    [prod[0]!.id],
  )
  const { rows: les } = await tx.query<{ id: string }>(
    `insert into public.lessons (section_id, title, position, kind, duration_seconds, storage_path)
     values ($1, 'A Lesson', 0, $2::public.lesson_kind, 600, $3) returning id`,
    [sec[0]!.id, kind, kind === 'video' ? 'x/y.mp4' : null],
  )
  return { productId: prod[0]!.id, sectionId: sec[0]!.id, lessonId: les[0]!.id }
}

const addQuiz = async (tx: Tx, lessonId: string, atSeconds: number | null = null) => {
  const { rows: q } = await tx.query<{ id: string }>(
    `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent)
     values ($1, 'Check', $2, 70) returning id`,
    [lessonId, atSeconds],
  )
  const { rows: qq } = await tx.query<{ id: string }>(
    `insert into public.quiz_questions (quiz_id, position, prompt)
     values ($1, 0, 'Which one?') returning id`,
    [q[0]!.id],
  )
  await tx.query(
    `insert into public.quiz_options (question_id, position, body, is_correct)
     values ($1, 0, 'Right', true), ($1, 1, 'Wrong', false)`,
    [qq[0]!.id],
  )
  return q[0]!.id
}

describe.skipIf(!HAS_DB)('admin_lesson_detail', () => {
  it('carries the answer key, and the learner read never does', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { lessonId } = await makeLesson(tx, by)
      await addQuiz(tx, lessonId, 180)
      // A preview, so the learner read opens without an entitlement and the
      // comparison is about the KEY rather than about the gate.
      await tx.query(`update public.lessons set is_preview = true where id = $1`, [lessonId])

      const { rows: adminRead } = await tx.query<{ d: unknown }>(
        `select public.admin_lesson_detail($1, $2) as d`,
        [by, lessonId],
      )
      const { rows: learnerRead } = await tx.query<{ d: unknown }>(
        `select public.lesson_for_learner($1, $2) as d`,
        [by, lessonId],
      )

      const adminJson = JSON.stringify(adminRead[0]!.d)
      const learnerJson = JSON.stringify(learnerRead[0]!.d)

      // The editor cannot mark an option correct on a screen that does not
      // know which one is.
      expect(adminJson).toContain('isCorrect')

      // And the learner sees the options without ever seeing which is right.
      expect(learnerJson).toContain('Right')
      expect(learnerJson).not.toContain('isCorrect')
      expect(learnerJson).not.toContain('is_correct')
    })
  })

  it('refuses anyone who is not a super admin', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { lessonId } = await makeLesson(tx, by)
      const nobody = await createUser(tx, { name: 'Not An Admin' })

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_lesson_detail($1, $2)`, [nobody.id, lessonId]),
      )
      expect(message).toMatch(/not an administrator/i)
    })
  })

  it('reports the same problem string the catalogue shows', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { lessonId } = await makeLesson(tx, by, 'article')
      // An article with no text — one of `lesson_is_ready`'s cases.
      await tx.query(`update public.lessons set body = null where id = $1`, [lessonId])

      const { rows } = await tx.query<{ d: { problem: string } }>(
        `select public.admin_lesson_detail($1, $2) as d`,
        [by, lessonId],
      )
      // One lesson must never get two different stories about what is wrong
      // with it, so the editor prints exactly what the publish check computes.
      expect(rows[0]!.d.problem).toMatch(/no text yet/i)
    })
  })
})

describe.skipIf(!HAS_DB)('admin_delete_quiz', () => {
  it('removes the quiz and everything under it', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { lessonId } = await makeLesson(tx, by)
      const quizId = await addQuiz(tx, lessonId, 90)

      await tx.query(`select public.admin_delete_quiz($1, $2)`, [by, quizId])

      const { rows } = await tx.query<{ quizzes: number; questions: number; options: number }>(
        `select (select count(*)::int from public.quizzes where id = $1) as quizzes,
                (select count(*)::int from public.quiz_questions where quiz_id = $1) as questions,
                (select count(*)::int from public.quiz_options o
                   join public.quiz_questions q on q.id = o.question_id
                  where q.quiz_id = $1) as options`,
        [quizId],
      )
      expect(rows[0]).toEqual({ quizzes: 0, questions: 0, options: 0 })
    })
  })

  it('unblocks a video that an empty checkpoint would have made unfinishable', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { productId, lessonId } = await makeLesson(tx, by)

      /*
        The case migration 136 exists for. A checkpoint with no questions can
        never be passed — and migration 119's rule is that EVERY in-video quiz
        must be passed before the lesson counts. So an empty checkpoint stops
        the video at a question that does not exist, and the course becomes
        unfinishable. Before 136 there was no way to remove it.
      */
      const { rows: empty } = await tx.query<{ id: string }>(
        `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent)
         values ($1, 'Stuck', 30, 70) returning id`,
        [lessonId],
      )

      await tx.query(`select public.admin_delete_quiz($1, $2)`, [by, empty[0]!.id])

      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.quizzes where lesson_id = $1`,
        [lessonId],
      )
      expect(rows[0]!.n).toBe(0)

      // And with it gone the lesson is publishable again.
      const { rows: blockers } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.product_publish_blockers($1)`,
        [productId],
      )
      expect(blockers[0]!.n).toBe(0)
    })
  })

  it('refuses anyone who is not a super admin', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { lessonId } = await makeLesson(tx, by)
      const quizId = await addQuiz(tx, lessonId)
      const nobody = await createUser(tx, { name: 'Not An Admin' })

      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_delete_quiz($1, $2)`, [nobody.id, quizId]),
      )
      expect(message).toMatch(/not an administrator/i)
    })
  })
})
