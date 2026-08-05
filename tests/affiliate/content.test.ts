import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createUser, withRollback } from '../support/db'

/**
 * Phase 2, step 2: the content engine.
 *
 * The interesting assertions here are the ones about EXPOSURE, not about
 * storage. Whether a lesson row can hold a title is not in doubt; whether a
 * signed-in stranger can read the storage path of a course they have not
 * bought very much is, and that is the difference between deterrent-level
 * protection working and not existing.
 *
 * The rest covers the two decisions this schema encodes: an ebook is text and
 * never a file (E32), and course video lives in a PRIVATE bucket rather than
 * the public one the ads use (E35).
 */

const admin = async (tx: Tx) => {
  const { rows } = await tx.query<{ id: string }>(
    `select user_id as id from public.user_roles where role = 'super_admin' limit 1`,
  )
  return rows[0]!.id
}

let seq = 0
const makeCourse = async (tx: Tx, by: string, status = 'published') => {
  seq += 1
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
     values ('course', 'vendor_product', 'A Course', $1, 20000, $2::public.product_status, $3)
     returning id`,
    [`course-${Date.now()}-${seq}`, status, by],
  )
  return rows[0]!.id
}

const makeSection = async (tx: Tx, productId: string, title = 'Section One', position = 0) => {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.course_sections (product_id, title, position)
     values ($1, $2, $3) returning id`,
    [productId, title, position],
  )
  return rows[0]!.id
}

const makeLesson = async (
  tx: Tx,
  sectionId: string,
  options: { title?: string; position?: number; preview?: boolean; path?: string } = {},
) => {
  const {
    title = 'Lesson One',
    position = 0,
    preview = false,
    path = 'secret/private-object-key.mp4',
  } = options
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.lessons (section_id, title, position, is_preview, storage_path, duration_seconds)
     values ($1, $2, $3, $4, $5, 600) returning id`,
    [sectionId, title, position, preview, path],
  )
  return rows[0]!.id
}

describe.skipIf(!HAS_DB)('where course video lives', () => {
  it('is a private bucket, unlike the ads bucket', async () => {
    await withRollback(async (tx) => {
      /* THE ONE THING THAT MUST NOT BE COPIED FROM PHASE 1. `ad-media` is
         public and correct — an advert exists to be seen. A public bucket URL
         is permanent and unauthenticated, so paid course video behind one is
         published on the open internet rather than merely downloadable. */
      const { rows } = await tx.query<{ id: string; public: boolean }>(
        `select id, public from storage.buckets where id in ('course-media', 'ad-media')`,
      )
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.public]))
      expect([byId['course-media'], byId['ad-media']]).toEqual([false, true])
    })
  })
})

describe.skipIf(!HAS_DB)('what a shopper can see of a course', () => {
  it('lists the curriculum without ever exposing a storage path', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const product = await makeCourse(tx, by)
      const section = await makeSection(tx, product)
      await makeLesson(tx, section, { title: 'Getting started', preview: true })
      await makeLesson(tx, section, { title: 'The paid part', position: 1 })

      const { rows, fields } = await tx.query(
        `select * from public.course_outline($1)`,
        [product],
      )

      expect(rows.length).toBe(2)
      expect(rows.map((r) => (r as { lesson_title: string }).lesson_title)).toEqual([
        'Getting started',
        'The paid part',
      ])

      /* The assertion that matters: the outline cannot leak a path even by
         accident, because the column is not in its return type at all. A
         select policy on `lessons` would have exposed it — RLS is row-level,
         not column-level — which is why there is no such policy. */
      expect(fields.map((f) => f.name)).not.toContain('storage_path')
    })
  })

  it('says nothing at all about an unpublished course', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const draft = await makeCourse(tx, by, 'draft')
      const section = await makeSection(tx, draft)
      await makeLesson(tx, section)

      const { rows } = await tx.query(`select * from public.course_outline($1)`, [draft])
      // A draft is a title and a price being staged. Leaking its curriculum
      // gives away unreleased work.
      expect(rows.length).toBe(0)
    })
  })

  it('keeps sections and lessons in the order the author set', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const product = await makeCourse(tx, by)
      const second = await makeSection(tx, product, 'Second', 1)
      const first = await makeSection(tx, product, 'First', 0)
      await makeLesson(tx, second, { title: 'B', position: 0 })
      await makeLesson(tx, first, { title: 'A', position: 0 })

      const { rows } = await tx.query<{ section_title: string; lesson_title: string }>(
        `select section_title, lesson_title from public.course_outline($1)`,
        [product],
      )
      expect(rows.map((r) => `${r.section_title}/${r.lesson_title}`)).toEqual(['First/A', 'Second/B'])
    })
  })
})

describe.skipIf(!HAS_DB)('an ebook is text, not a file', () => {
  it('stores chapters with no storage key anywhere on the table', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      seq += 1
      const { rows: made } = await tx.query<{ id: string }>(
        `insert into public.products (kind, purpose, title, slug, price_minor, status, created_by)
         values ('ebook', 'vendor_product', 'A Book', $1, 5000, 'published', $2) returning id`,
        [`book-${Date.now()}-${seq}`, by],
      )
      const product = made[0]!.id

      await tx.query(
        `insert into public.ebook_chapters (product_id, title, position, body, word_count)
         values ($1, 'Chapter One', 0, 'Once upon a time.', 4)`,
        [product],
      )

      /* E32 as a schema property rather than a convention: there is no column
         that could hold a path to a whole PDF, so nothing can later be
         "temporarily" served as a file. */
      const { rows: cols } = await tx.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'ebook_chapters'`,
      )
      const names = cols.map((c) => c.column_name)
      expect(names).toContain('body')
      expect(names.filter((n) => /storage|file|path|key/i.test(n))).toEqual([])
    })
  })
})

describe.skipIf(!HAS_DB)('progress belongs to the learner', () => {
  it('records a watch percentage and a quiz result separately', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Learner' })
      const product = await makeCourse(tx, by)
      const section = await makeSection(tx, product)
      const lesson = await makeLesson(tx, section)

      /* B10 requires BOTH. Kept as two independent facts because the
         thresholds that judge them belong to the training program, not to the
         lesson — the Owner can change what "complete" means without rewriting
         anybody's history. */
      await tx.query(
        `insert into public.lesson_progress (user_id, lesson_id, seconds_watched, watched_percent, quiz_passed)
         values ($1, $2, 540, 90, true)`,
        [user.id, lesson],
      )

      const { rows } = await tx.query<{ watched_percent: number; quiz_passed: boolean }>(
        `select watched_percent, quiz_passed from public.lesson_progress
          where user_id = $1 and lesson_id = $2`,
        [user.id, lesson],
      )
      expect([rows[0]!.watched_percent, rows[0]!.quiz_passed]).toEqual([90, true])
    })
  })

  it('refuses a watch percentage outside 0-100', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Over Watcher' })
      const product = await makeCourse(tx, by)
      const section = await makeSection(tx, product)
      const lesson = await makeLesson(tx, section)

      let refused = false
      try {
        await tx.query(
          `insert into public.lesson_progress (user_id, lesson_id, watched_percent)
           values ($1, $2, 140)`,
          [user.id, lesson],
        )
      } catch {
        refused = true
      }
      expect(refused).toBe(true)
    })
  })

  it('is one row per learner per lesson, so progress cannot fork', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Rewatcher' })
      const product = await makeCourse(tx, by)
      const section = await makeSection(tx, product)
      const lesson = await makeLesson(tx, section)

      await tx.query(
        `insert into public.lesson_progress (user_id, lesson_id, watched_percent) values ($1, $2, 30)`,
        [user.id, lesson],
      )
      await tx.query(
        `insert into public.lesson_progress (user_id, lesson_id, watched_percent) values ($1, $2, 95)
         on conflict (user_id, lesson_id) do update set watched_percent = excluded.watched_percent`,
        [user.id, lesson],
      )

      const { rows } = await tx.query<{ n: string; pct: number }>(
        `select count(*)::text n, max(watched_percent) pct from public.lesson_progress
          where user_id = $1 and lesson_id = $2`,
        [user.id, lesson],
      )
      expect([Number(rows[0]!.n), rows[0]!.pct]).toEqual([1, 95])
    })
  })
})

describe.skipIf(!HAS_DB)('certificates', () => {
  it('mints an unguessable code from a clean alphabet', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query<{ code: string }>(
        `select public.generate_certificate_code() as code from generate_series(1, 30)`,
      )
      const codes = rows.map((r) => r.code)

      expect(codes.every((c) => c.length === 12)).toBe(true)
      // No I, L, O, U, 1 or 0 — a code is read off a screen and typed back.
      expect(codes.every((c) => /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/.test(c))).toBe(true)
      /* From gen_random_bytes, not random(). Postgres's random() is a seeded
         deterministic PRNG, and a guessable code makes a certificate forgeable
         by counting. Thirty draws colliding would mean it is not random. */
      expect(new Set(codes).size).toBe(30)
    })
  })

  it('gives one certificate per person per product', async () => {
    await withRollback(async (tx) => {
      const by = await admin(tx)
      const user = await createUser(tx, { name: 'Graduate' })
      const product = await makeCourse(tx, by)

      await tx.query(
        `insert into public.certificates (user_id, product_id, verification_code)
         values ($1, $2, public.generate_certificate_code())`,
        [user.id, product],
      )

      let refused = false
      try {
        await tx.query(
          `insert into public.certificates (user_id, product_id, verification_code)
           values ($1, $2, public.generate_certificate_code())`,
          [user.id, product],
        )
      } catch {
        refused = true
      }
      expect(refused).toBe(true)
    })
  })
})
