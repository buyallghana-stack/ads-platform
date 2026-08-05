import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Phase 2: the curriculum framework — video, article, reading and quizzes.
 *
 * Two things here are worth more than the rest, because both are ways somebody
 * could be handed money or a right they have not earned:
 *
 *  - A QUIZ IS MARKED ON THE SERVER. Passing one can complete a lesson, and
 *    completing enough lessons activates an affiliate account (B9). A quiz
 *    scored in the browser would be a browser-granted right to earn.
 *  - `is_correct` IS NOT IN THE LEARNER'S VIEW AT ALL — not filtered, absent
 *    from the shape, so it cannot come back by accident.
 *
 * The rest covers the completion rule now that it has to answer for four
 * different kinds of item, and it still has to be one-way.
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

/** A training product with one section, ready to hang lessons off. */
const makeCourse = async (
  tx: Tx,
  by: string,
  o: { threshold?: number; quizRequired?: boolean; passPercent?: number } = {},
) => {
  const { threshold = 50, quizRequired = true, passPercent = 90 } = o
  seq += 1
  const { rows: prod } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'training_program', 'Curriculum', $1, 15000, 'published', $2) returning id`,
    [`curr-${Date.now()}-${seq}`, by],
  )
  const productId = prod[0]!.id
  await tx.query(
    `insert into public.training_programs
       (product_id, level, commission_depth, activation_threshold_percent,
        lesson_pass_percent, quiz_required)
     values ($1, 'beginner', 1, $2, $3, $4)`,
    [productId, threshold, passPercent, quizRequired],
  )
  const { rows: sec } = await tx.query<{ id: string }>(
    `insert into public.course_sections (product_id, title, position)
     values ($1, 'Section One', 0) returning id`,
    [productId],
  )
  return { productId, sectionId: sec[0]!.id }
}

const addLesson = async (
  tx: Tx,
  sectionId: string,
  o: { kind?: string; title?: string; position?: number; body?: string | null; path?: string | null } = {},
) => {
  const { kind = 'video', title = 'A Lesson', position = 0 } = o
  /* `in` rather than `??`: passing an explicit null is how a test says "no
     file", and `??` treats null as absent and hands back the default — which
     silently turned the refusal test into a test of nothing. */
  const body = 'body' in o ? (o.body ?? null) : kind === 'article' ? 'Some words to read here.' : null
  const path = 'path' in o ? (o.path ?? null) : kind === 'video' ? 'private/lesson.mp4' : null
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.lessons (section_id, kind, title, position, body, storage_path, duration_seconds)
     values ($1, $2::public.lesson_kind, $3, $4, $5, $6, 600) returning id`,
    [sectionId, kind, title, position, body, path],
  )
  return rows[0]!.id
}

/** A quiz with one question and two options; the first option is correct. */
const addQuiz = async (
  tx: Tx,
  lessonId: string,
  o: { atSeconds?: number | null; pass?: number; questions?: number } = {},
) => {
  const { atSeconds = null, pass = 70, questions = 1 } = o
  const { rows: q } = await tx.query<{ id: string }>(
    `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent)
     values ($1, 'Check', $2, $3) returning id`,
    [lessonId, atSeconds, pass],
  )
  const quizId = q[0]!.id
  const correct: Record<string, string> = {}

  for (let i = 0; i < questions; i += 1) {
    const { rows: qq } = await tx.query<{ id: string }>(
      `insert into public.quiz_questions (quiz_id, position, prompt)
       values ($1, $2, $3) returning id`,
      [quizId, i, `Question ${i + 1}?`],
    )
    const { rows: right } = await tx.query<{ id: string }>(
      `insert into public.quiz_options (question_id, position, body, is_correct)
       values ($1, 0, 'Right', true) returning id`,
      [qq[0]!.id],
    )
    await tx.query(
      `insert into public.quiz_options (question_id, position, body, is_correct)
       values ($1, 1, 'Wrong', false)`,
      [qq[0]!.id],
    )
    correct[qq[0]!.id] = right[0]!.id
  }

  return { quizId, correct }
}

const submit = async (tx: Tx, userId: string, quizId: string, answers: Record<string, string>) => {
  const { rows } = await tx.query<{ score_percent: number; passed: boolean }>(
    `select score_percent, passed from public.submit_quiz_attempt($1, $2, $3::jsonb)`,
    [userId, quizId, JSON.stringify(answers)],
  )
  return rows[0]!
}

const completion = async (tx: Tx, userId: string, productId: string) => {
  const { rows } = await tx.query<{ p: number }>(
    `select public.training_completion_percent($1, $2) as p`,
    [userId, productId],
  )
  return rows[0]!.p
}

describe.skipIf(!HAS_DB)('what a curriculum item can be', () => {
  it('holds video, article, reading and quiz items in one ordered list', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Browser' })
      const { productId, sectionId } = await makeCourse(tx, by)

      await addLesson(tx, sectionId, { kind: 'video', title: 'Watch this', position: 0 })
      await addLesson(tx, sectionId, { kind: 'article', title: 'Read this', position: 1 })
      const pdf = await addLesson(tx, sectionId, { kind: 'pdf', title: 'The handbook', position: 2 })
      const quizLesson = await addLesson(tx, sectionId, { kind: 'quiz', title: 'Section quiz', position: 3 })
      await addQuiz(tx, quizLesson)

      await tx.query(
        `insert into public.lesson_resources (lesson_id, title, storage_path)
         values ($1, 'Handbook.pdf', 'private/handbook.pdf')`,
        [pdf],
      )

      const { rows } = await tx.query<{
        lesson_title: string
        kind: string
        resource_count: number
        quiz_count: number
      }>(
        `select lesson_title, kind, resource_count, quiz_count
           from public.course_curriculum($1, $2)`,
        [productId, user.id],
      )

      expect(rows.map((r) => [r.lesson_title, r.kind])).toEqual([
        ['Watch this', 'video'],
        ['Read this', 'article'],
        ['The handbook', 'pdf'],
        ['Section quiz', 'quiz'],
      ])
      // "Article - Resources (1)" in the reference screenshots.
      expect(rows[2]!.resource_count).toBe(1)
      expect(rows[3]!.quiz_count).toBe(1)
    })
  })

  it('lets a lesson be saved before its content exists, and refuses to PUBLISH it', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { productId, sectionId } = await makeCourse(tx, by)

      /* The authoring order is create-then-upload: an admin adds "Lesson 3",
         saves it, and the video follows — possibly not in the same sitting.
         Migration 119 demanded the file up front and broke fourteen existing
         tests that create lessons the way the admin will; 120 moved the check
         to publish time, where it can say what is missing in a sentence. */
      const video = await addLesson(tx, sectionId, { kind: 'video', path: null })
      const article = await addLesson(tx, sectionId, {
        kind: 'article',
        body: '   ',
        position: 1,
      })

      const ready = async (id: string) => {
        const { rows } = await tx.query<{ r: string | null }>(
          `select public.lesson_is_ready($1) as r`,
          [id],
        )
        return rows[0]!.r
      }

      expect(await ready(video)).toMatch(/no file yet/i)
      expect(await ready(article)).toMatch(/no text yet/i)

      /* And the whole product reports EVERY unready lesson, not just the
         first — an admin fixing them one at a time, discovering the next only
         after saving, is the version of this that wastes an afternoon. */
      const { rows } = await tx.query<{ problem: string }>(
        `select problem from public.product_publish_blockers($1)`,
        [productId],
      )
      expect(rows.length).toBe(2)
    })
  })

  it('reports what is missing before a lesson is published', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { sectionId } = await makeCourse(tx, by)

      const pdf = await addLesson(tx, sectionId, { kind: 'pdf' })
      const quizLesson = await addLesson(tx, sectionId, { kind: 'quiz', position: 1 })

      const ready = async (id: string) => {
        const { rows } = await tx.query<{ r: string | null }>(
          `select public.lesson_is_ready($1) as r`,
          [id],
        )
        return rows[0]!.r
      }

      expect(await ready(pdf)).toMatch(/at least one resource/i)
      expect(await ready(quizLesson)).toMatch(/needs a quiz/i)

      await tx.query(
        `insert into public.lesson_resources (lesson_id, title, storage_path)
         values ($1, 'Handbook.pdf', 'private/h.pdf')`,
        [pdf],
      )
      expect(await ready(pdf)).toBeNull()
    })
  })

  it('catches a question nobody could ever answer', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { sectionId } = await makeCourse(tx, by)
      const lesson = await addLesson(tx, sectionId, { kind: 'quiz' })

      const { rows: q } = await tx.query<{ id: string }>(
        `insert into public.quizzes (lesson_id, title) values ($1, 'Broken') returning id`,
        [lesson],
      )
      const { rows: qq } = await tx.query<{ id: string }>(
        `insert into public.quiz_questions (quiz_id, position, prompt)
         values ($1, 0, 'Impossible?') returning id`,
        [q[0]!.id],
      )
      await tx.query(
        `insert into public.quiz_options (question_id, position, body, is_correct)
         values ($1, 0, 'A', false), ($1, 1, 'B', false)`,
        [qq[0]!.id],
      )

      /* A question with no correct option leaves the learner stuck on a screen
         that looks like their fault. */
      const { rows } = await tx.query<{ r: string | null }>(
        `select public.lesson_is_ready($1) as r`,
        [lesson],
      )
      expect(rows[0]!.r).toMatch(/no correct answer/i)
    })
  })
})

describe.skipIf(!HAS_DB)('a quiz is marked on the server', () => {
  it('never shows the learner which option is right', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const { sectionId } = await makeCourse(tx, by)
      const lesson = await addLesson(tx, sectionId, { kind: 'quiz' })
      const { quizId } = await addQuiz(tx, lesson)

      const { rows, fields } = await tx.query(`select * from public.quiz_for_learner($1)`, [quizId])

      expect(rows.length).toBe(2) // one question, two options
      /* Absent from the SHAPE, not filtered out of it. A column that is not in
         the return type cannot be added back by a careless edit. */
      expect(fields.map((f) => f.name)).not.toContain('is_correct')
    })
  })

  it('scores a right answer and a wrong one', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Quizzed' })
      const { sectionId } = await makeCourse(tx, by)
      const lesson = await addLesson(tx, sectionId, { kind: 'quiz' })
      const { quizId, correct } = await addQuiz(tx, lesson, { questions: 2, pass: 70 })

      const questionIds = Object.keys(correct)

      // Both right → 100%.
      const good = await submit(tx, user.id, quizId, correct)
      expect([good.score_percent, good.passed]).toEqual([100, true])

      // One right → 50%, under a 70% pass mark.
      const half = await submit(tx, user.id, quizId, {
        [questionIds[0]!]: correct[questionIds[0]!]!,
        [questionIds[1]!]: questionIds[1]!, // not an option id at all
      })
      expect([half.score_percent, half.passed]).toEqual([50, false])
    })
  })

  it('keeps every attempt, not just the best', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Retrier' })
      const { sectionId } = await makeCourse(tx, by)
      const lesson = await addLesson(tx, sectionId, { kind: 'quiz' })
      const { quizId, correct } = await addQuiz(tx, lesson)

      await submit(tx, user.id, quizId, {})
      await submit(tx, user.id, quizId, correct)

      const { rows } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.quiz_attempts where user_id = $1 and quiz_id = $2`,
        [user.id, quizId],
      )
      // The history is what tells the Owner a quiz is too hard.
      expect(Number(rows[0]!.n)).toBe(2)
    })
  })
})

describe.skipIf(!HAS_DB)('when a lesson counts as done', () => {
  it('completes a quiz lesson by passing it', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Passer' })
      const { productId, sectionId } = await makeCourse(tx, by, { threshold: 100 })
      const lesson = await addLesson(tx, sectionId, { kind: 'quiz' })
      const { quizId, correct } = await addQuiz(tx, lesson)

      expect(await completion(tx, user.id, productId)).toBe(0)
      await submit(tx, user.id, quizId, correct)
      expect(await completion(tx, user.id, productId)).toBe(100)
    })
  })

  it('completes an article by marking it read', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Reader' })
      const { productId, sectionId } = await makeCourse(tx, by, { threshold: 100 })
      const lesson = await addLesson(tx, sectionId, { kind: 'article' })

      expect(await completion(tx, user.id, productId)).toBe(0)
      await tx.query(`select public.mark_lesson_read($1, $2)`, [user.id, lesson])
      expect(await completion(tx, user.id, productId)).toBe(100)
    })
  })

  it('refuses to mark a video read', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Cheater' })
      const { sectionId } = await makeCourse(tx, by)
      const lesson = await addLesson(tx, sectionId, { kind: 'video' })

      /* Otherwise "mark read" is a one-tap way past every video in the course,
         and past the activation threshold with it. */
      const message = await expectRejection(tx, () =>
        tx.query(`select public.mark_lesson_read($1, $2)`, [user.id, lesson]),
      )
      expect(message).toMatch(/only an article or reading lesson/i)
    })
  })

  it('holds a video incomplete until its in-video quiz is passed', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Watcher' })
      const { productId, sectionId } = await makeCourse(tx, by, {
        threshold: 100,
        quizRequired: true,
      })
      const lesson = await addLesson(tx, sectionId, { kind: 'video' })
      const { quizId, correct } = await addQuiz(tx, lesson, { atSeconds: 120 })

      // Watched to the end, questions unanswered.
      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, null)`, [
        user.id,
        lesson,
      ])
      /* That is what an in-video quiz is FOR. A video played to the end with
         its questions untouched is not a lesson somebody has done. */
      expect(await completion(tx, user.id, productId)).toBe(0)

      await submit(tx, user.id, quizId, correct)
      expect(await completion(tx, user.id, productId)).toBe(100)
    })
  })

  it('needs every in-video quiz, not just one of them', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Halfway' })
      const { productId, sectionId } = await makeCourse(tx, by, { threshold: 100 })
      const lesson = await addLesson(tx, sectionId, { kind: 'video' })
      const first = await addQuiz(tx, lesson, { atSeconds: 60 })
      const second = await addQuiz(tx, lesson, { atSeconds: 300 })

      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, null)`, [
        user.id,
        lesson,
      ])
      await submit(tx, user.id, first.quizId, first.correct)
      expect(await completion(tx, user.id, productId)).toBe(0)

      await submit(tx, user.id, second.quizId, second.correct)
      expect(await completion(tx, user.id, productId)).toBe(100)
    })
  })

  it('never un-completes a lesson', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Rewatcher' })
      const { productId, sectionId } = await makeCourse(tx, by, {
        threshold: 100,
        quizRequired: false,
      })
      const lesson = await addLesson(tx, sectionId, { kind: 'video' })

      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, null)`, [user.id, lesson])
      expect(await completion(tx, user.id, productId)).toBe(100)

      // Scrubbing back to the start.
      await tx.query(`select public.record_lesson_progress($1, $2, 5, 2, null)`, [user.id, lesson])
      /* Activation is a one-way flip (B9), and this is what makes that true
         one level down. */
      expect(await completion(tx, user.id, productId)).toBe(100)
    })
  })

  it('counts every kind alike towards the percentage', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Mixed' })
      const { productId, sectionId } = await makeCourse(tx, by, {
        threshold: 100,
        quizRequired: false,
      })
      const video = await addLesson(tx, sectionId, { kind: 'video', position: 0 })
      const article = await addLesson(tx, sectionId, { kind: 'article', position: 1 })
      const quizLesson = await addLesson(tx, sectionId, { kind: 'quiz', position: 2 })
      const { quizId, correct } = await addQuiz(tx, quizLesson)
      const pdf = await addLesson(tx, sectionId, { kind: 'pdf', position: 3 })

      await tx.query(`select public.record_lesson_progress($1, $2, 600, 100, null)`, [user.id, video])
      expect(await completion(tx, user.id, productId)).toBe(25)

      await tx.query(`select public.mark_lesson_read($1, $2)`, [user.id, article])
      expect(await completion(tx, user.id, productId)).toBe(50)

      await submit(tx, user.id, quizId, correct)
      expect(await completion(tx, user.id, productId)).toBe(75)

      await tx.query(`select public.mark_lesson_read($1, $2)`, [user.id, pdf])
      expect(await completion(tx, user.id, productId)).toBe(100)
    })
  })

  it('still activates the affiliate at the threshold', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Activating' })
      const { productId, sectionId } = await makeCourse(tx, by, {
        threshold: 50,
        quizRequired: false,
      })
      await addLesson(tx, sectionId, { kind: 'article', title: 'One', position: 0 })
      const two = await addLesson(tx, sectionId, { kind: 'article', title: 'Two', position: 1 })

      // Buying is what creates the account; here it is made directly, since
      // the purchase path has its own tests.
      await tx.query(
        `insert into public.affiliate_accounts (user_id, affiliate_code, status)
         values ($1, public.generate_affiliate_code(), 'pending')`,
        [user.id],
      )

      await tx.query(`select public.mark_lesson_read($1, $2)`, [user.id, two])

      const { rows } = await tx.query<{ status: string }>(
        `select status::text from public.affiliate_accounts where user_id = $1`,
        [user.id],
      )
      // 50% of the course read, and the right to promote follows.
      expect(rows[0]!.status).toBe('active')
    })
  })
})
