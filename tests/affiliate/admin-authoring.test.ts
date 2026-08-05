import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, expectRejection, withRollback } from '../support/db'

/**
 * Admin authoring: vendors, products, curriculum, quizzes.
 *
 * The interesting assertions are the REFUSALS, because authoring is
 * money-adjacent in a way that is easy to miss: completing a share of a
 * training program activates an affiliate account, so whoever can add or
 * delete a lesson can move the denominator that decides who may earn.
 *
 * Three of them matter most —
 *   publishing is refused while anything is unfinished,
 *   deleting a lesson somebody has started is refused outright,
 *   and a quiz question cannot be saved without a correct answer.
 */

const superAdmin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0

const saveProduct = async (tx: Tx, by: string, o: Record<string, unknown> = {}) => {
  seq += 1
  const { rows } = await tx.query<{ id: string; status: string }>(
    `select id, status::text from public.admin_save_product($1, $2::jsonb)`,
    [
      by,
      JSON.stringify({
        kind: 'course',
        purpose: 'vendor_product',
        title: 'A Course',
        slug: `admin-${Date.now()}-${seq}`,
        priceGhs: 200,
        ...o,
      }),
    ],
  )
  return rows[0]!
}

const saveSection = async (tx: Tx, by: string, productId: string, title = 'Section One') => {
  const { rows } = await tx.query<{ id: string }>(
    `select id from public.admin_save_section($1, $2::jsonb)`,
    [by, JSON.stringify({ productId, title })],
  )
  return rows[0]!.id
}

const saveLesson = async (tx: Tx, by: string, sectionId: string, o: Record<string, unknown> = {}) => {
  const { rows } = await tx.query<{ id: string; position: number }>(
    `select id, position from public.admin_save_lesson($1, $2::jsonb)`,
    [by, JSON.stringify({ sectionId, kind: 'video', title: 'A Lesson', ...o })],
  )
  return rows[0]!
}

const publish = async (tx: Tx, by: string, productId: string) =>
  tx.query(`select public.admin_set_product_status($1, $2, 'published')`, [by, productId])

describe.skipIf(!HAS_DB)('who may author', () => {
  it('refuses somebody who is not an administrator', async () => {
    await withRollback(async (tx) => {
      const stranger = await createUser(tx, { name: 'Not An Admin' })
      /* Authoring moves the denominator that decides who becomes an affiliate,
         so it fails closed like the rest of the money path. */
      const message = await expectRejection(tx, () =>
        saveProduct(tx, stranger.id),
      )
      expect(message).toMatch(/admin/i)
    })
  })
})

describe.skipIf(!HAS_DB)('products', () => {
  it('creates as draft, never straight to published', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      // Nothing goes on sale by accident; publishing is its own decision.
      expect(product.status).toBe('draft')
    })
  })

  it('refuses to publish while anything is unfinished, and says what', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      await saveLesson(tx, by, section, { kind: 'video' })   // no file yet

      const message = await expectRejection(tx, () => publish(tx, by, product.id))
      expect(message).toMatch(/not ready to publish/i)
      expect(message).toMatch(/no file yet/i)
    })
  })

  it('publishes once the gaps are filled', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const lesson = await saveLesson(tx, by, section, { kind: 'video' })

      /* The authoring order: the row exists, then the upload attaches to it.
         That is why the file arrives through an update rather than being
         demanded at insert. */
      await tx.query(`select public.admin_save_lesson($1, $2::jsonb)`, [
        by,
        JSON.stringify({ id: lesson.id, storagePath: 'private/lesson.mp4' }),
      ])

      await publish(tx, by, product.id)
      const { rows } = await tx.query<{ status: string; published_at: string | null }>(
        `select status::text, published_at::text from public.products where id = $1`,
        [product.id],
      )
      expect(rows[0]!.status).toBe('published')
      expect(rows[0]!.published_at).not.toBeNull()
    })
  })

  it('never refuses to UNpublish', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const lesson = await saveLesson(tx, by, section)
      await tx.query(`select public.admin_save_lesson($1, $2::jsonb)`, [
        by,
        JSON.stringify({ id: lesson.id, storagePath: 'private/l.mp4' }),
      ])
      await publish(tx, by, product.id)

      /* Taking something off sale is what an operator does when something IS
         wrong. A gate on the way out would trap them with it live. */
      await tx.query(`select public.admin_set_product_status($1, $2, 'paused')`, [by, product.id])
      const { rows } = await tx.query<{ status: string }>(
        `select status::text from public.products where id = $1`,
        [product.id],
      )
      expect(rows[0]!.status).toBe('paused')
    })
  })

  it('writes a price change to the audit trail', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by, { priceGhs: 200 })

      await tx.query(`select public.admin_save_product($1, $2::jsonb)`, [
        by,
        JSON.stringify({ id: product.id, priceGhs: 250 }),
      ])

      const { rows } = await tx.query<{ old_price: string; new_price: string }>(
        `select old_values->>'price_minor' as old_price, new_values->>'price_minor' as new_price
           from public.admin_audit_log
          where entity_type = 'products' and entity_id = $1 and action = 'update'`,
        [product.id],
      )
      // Money changed hands over this figure; the old value sits beside the new.
      expect([rows[0]!.old_price, rows[0]!.new_price]).toEqual(['20000', '25000'])
    })
  })

  it('clears a sale price when the form sends null', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by, { priceGhs: 200, salePriceGhs: 120 })

      const priced = async () => {
        const { rows } = await tx.query<{ p: string }>(
          `select public.product_price_minor($1)::text as p`,
          [product.id],
        )
        return Number(rows[0]!.p)
      }
      expect(await priced()).toBe(12_000)

      /* Key presence, not coalesce: null is how a form says "end the sale",
         and coalesce cannot tell that apart from "leave it alone". */
      await tx.query(`select public.admin_save_product($1, $2::jsonb)`, [
        by,
        JSON.stringify({ id: product.id, salePriceGhs: null }),
      ])
      expect(await priced()).toBe(20_000)
    })
  })
})

describe.skipIf(!HAS_DB)('curriculum', () => {
  it('appends lessons in order without being told the position', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)

      const first = await saveLesson(tx, by, section, { title: 'One' })
      const second = await saveLesson(tx, by, section, { title: 'Two' })
      const third = await saveLesson(tx, by, section, { title: 'Three' })

      expect([first.position, second.position, third.position]).toEqual([0, 1, 2])
    })
  })

  it('reorders in ONE call, not one per item', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const a = await saveLesson(tx, by, section, { title: 'A' })
      const b = await saveLesson(tx, by, section, { title: 'B' })
      const c = await saveLesson(tx, by, section, { title: 'C' })

      /* A drag-and-drop list that saves item by item leaves the curriculum
         half-reordered the moment the network drops. */
      await tx.query(`select public.admin_reorder_lessons($1, $2, $3::uuid[])`, [
        by,
        section,
        [c.id, a.id, b.id],
      ])

      const { rows } = await tx.query<{ title: string }>(
        `select title from public.lessons where section_id = $1 order by position`,
        [section],
      )
      expect(rows.map((r) => r.title)).toEqual(['C', 'A', 'B'])
    })
  })

  it('refuses to delete a lesson somebody has started', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const learner = await createUser(tx, { name: 'Started It' })
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const lesson = await saveLesson(tx, by, section)

      await tx.query(
        `insert into public.lesson_progress (user_id, lesson_id, watched_percent)
         values ($1, $2, 40)`,
        [learner.id, lesson.id],
      )

      /* `lesson_progress` cascades, so a delete would silently remove somebody's
         completion — and completion is the denominator that decides who is an
         affiliate. An admin tidying a curriculum must not be able to change who
         may earn money without being told. */
      const message = await expectRejection(tx, () =>
        tx.query(`select public.admin_delete_lesson($1, $2)`, [by, lesson.id]),
      )
      expect(message).toMatch(/already started this lesson/i)
    })
  })

  it('deletes one nobody has touched', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const lesson = await saveLesson(tx, by, section)

      await tx.query(`select public.admin_delete_lesson($1, $2)`, [by, lesson.id])
      const { rows } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.lessons where id = $1`,
        [lesson.id],
      )
      expect(Number(rows[0]!.n)).toBe(0)
    })
  })

  it('shows the author what is unfinished, per lesson', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      await saveLesson(tx, by, section, { kind: 'video', title: 'No file' })
      await saveLesson(tx, by, section, { kind: 'pdf', title: 'No resource' })

      const { rows } = await tx.query<{ lesson_title: string; problem: string | null }>(
        `select lesson_title, problem from public.admin_course_curriculum($1)`,
        [product.id],
      )
      expect(rows.map((r) => r.problem)).toEqual([
        expect.stringMatching(/no file yet/i),
        expect.stringMatching(/at least one resource/i),
      ])
    })
  })
})

describe.skipIf(!HAS_DB)('quiz authoring', () => {
  const saveQuestion = async (tx: Tx, by: string, question: Record<string, unknown>) => {
    const { rows } = await tx.query<{ id: string }>(
      `select public.admin_save_quiz_question($1, $2::jsonb) as id`,
      [by, JSON.stringify(question)],
    )
    return rows[0]!.id
  }

  const quizFor = async (tx: Tx, by: string, lessonId: string, atSeconds: number | null = null) => {
    const { rows } = await tx.query<{ id: string }>(
      `select id from public.admin_save_quiz($1, $2::jsonb)`,
      [by, JSON.stringify({ lessonId, atSeconds, passPercent: 70 })],
    )
    return rows[0]!.id
  }

  it('saves a question and its options together', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const lesson = await saveLesson(tx, by, section, { kind: 'quiz' })
      const quiz = await quizFor(tx, by, lesson.id)

      const id = await saveQuestion(tx, by, {
        quizId: quiz,
        prompt: 'Which is right?',
        options: [
          { body: 'This one', isCorrect: true },
          { body: 'Not this', isCorrect: false },
        ],
      })

      const { rows } = await tx.query<{ n: string }>(
        `select count(*)::text n from public.quiz_options where question_id = $1`,
        [id],
      )
      expect(Number(rows[0]!.n)).toBe(2)
    })
  })

  it('refuses a question with no correct answer', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const lesson = await saveLesson(tx, by, section, { kind: 'quiz' })
      const quiz = await quizFor(tx, by, lesson.id)

      /* Caught at the point of authoring rather than at publish time, because
         the person who can fix it is the one typing. */
      const message = await expectRejection(tx, () =>
        saveQuestion(tx, by, {
          quizId: quiz,
          prompt: 'Impossible?',
          options: [
            { body: 'A', isCorrect: false },
            { body: 'B', isCorrect: false },
          ],
        }),
      )
      expect(message).toMatch(/needs a correct answer/i)
    })
  })

  it('refuses a question with fewer than two options', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const lesson = await saveLesson(tx, by, section, { kind: 'quiz' })
      const quiz = await quizFor(tx, by, lesson.id)

      const message = await expectRejection(tx, () =>
        saveQuestion(tx, by, {
          quizId: quiz,
          prompt: 'Only one?',
          options: [{ body: 'Yes', isCorrect: true }],
        }),
      )
      expect(message).toMatch(/at least two options/i)
    })
  })

  it('REPLACES options on edit rather than merging them', async () => {
    await withRollback(async (tx) => {
      const by = await superAdmin(tx)
      const product = await saveProduct(tx, by)
      const section = await saveSection(tx, by, product.id)
      const lesson = await saveLesson(tx, by, section, { kind: 'quiz' })
      const quiz = await quizFor(tx, by, lesson.id)

      const id = await saveQuestion(tx, by, {
        quizId: quiz,
        prompt: 'First draft',
        options: [
          { body: 'Old right', isCorrect: true },
          { body: 'Old wrong', isCorrect: false },
          { body: 'To be removed', isCorrect: false },
        ],
      })

      await saveQuestion(tx, by, {
        id,
        quizId: quiz,
        prompt: 'Second draft',
        options: [
          { body: 'New right', isCorrect: true },
          { body: 'New wrong', isCorrect: false },
        ],
      })

      const { rows } = await tx.query<{ body: string }>(
        `select body from public.quiz_options where question_id = $1 order by position`,
        [id],
      )
      /* Merging would leave the removed option sitting there and still
         markable — a learner could pick an answer the author deleted. */
      expect(rows.map((r) => r.body)).toEqual(['New right', 'New wrong'])
    })
  })
})
