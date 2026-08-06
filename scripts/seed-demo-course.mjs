/**
 * A DEMO course with real video, so the player can actually be used.
 *
 *   node scripts/seed-demo-course.mjs           create it
 *   node scripts/seed-demo-course.mjs --wipe    remove it entirely
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE PRODUCT AND NOT PART OF THE TRAINING
 *
 * The video files are Blender Foundation open movies, CC-BY. Free to use, and
 * free to use COMMERCIALLY — but only with attribution. Dropping them into a
 * course that sells for GHS 400 would mean the attribution requirement travels
 * with a paid product forever, and somebody would eventually edit the lesson
 * that carries the credit without knowing why it was there.
 *
 * So this is its own product, permanently `draft`, clearly named as a demo, and
 * deletable in one command. It exists to exercise the player — video playback,
 * resuming, in-video checkpoints, seek clamping, the quiz, progress — not to be
 * sold. `--wipe` removes the rows AND the uploaded files.
 *
 * ---------------------------------------------------------------------------
 * THE FILES GO TO THE PRIVATE BUCKET LIKE ANY OTHER LESSON
 *
 * Uploaded to `course-media` with the service key, exactly where the admin
 * editor puts them. Learners still reach them only through a 15-minute signed
 * URL issued after an entitlement check — the demo does not get a side door,
 * because a side door is the thing most worth testing that it does not exist.
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { Client } from 'pg'

const WIPE = process.argv.includes('--wipe')
const MEDIA_DIR = process.env.MEDIA_DIR
const SLUG = 'demo-player-sandbox'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY

/** Uploads one file to `course-media` and returns the key it landed on. */
async function upload(key, bytes, contentType) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/course-media/${key}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: bytes,
    },
  )
  if (!response.ok) throw new Error(`upload ${key}: ${response.status} ${await response.text()}`)
  return key
}

async function removeAll(keys) {
  if (keys.length === 0) return
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/course-media`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: keys }),
  })
  if (!response.ok) console.warn(`storage cleanup: ${response.status}`)
}

const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()

try {
  const { rows: admin } = await c.query(
    `select user_id from public.user_roles where role = 'super_admin' limit 1`,
  )
  if (!admin[0]) throw new Error('No super admin to attribute this to.')

  /* ---------------- wipe ---------------- */
  const { rows: existing } = await c.query(`select id from public.products where slug = $1`, [SLUG])
  if (existing[0]) {
    const { rows: paths } = await c.query(
      `select l.storage_path from public.lessons l
         join public.course_sections s on s.id = l.section_id
        where s.product_id = $1 and l.storage_path is not null`,
      [existing[0].id],
    )
    await removeAll(paths.map((p) => p.storage_path))
    await c.query(`delete from public.products where id = $1`, [existing[0].id])
    console.log('removed the previous demo course and its files')
  }
  if (WIPE) {
    console.log('done')
    process.exit(0)
  }

  if (!MEDIA_DIR) throw new Error('Set MEDIA_DIR to the folder holding the .mp4 files.')

  /* ---------------- files ---------------- */
  const files = (await readdir(MEDIA_DIR))
    .filter((f) => f.endsWith('.mp4'))
    .sort()
  const usable = []
  for (const name of files) {
    const bytes = await readFile(path.join(MEDIA_DIR, name))
    if (bytes.length < 100_000) continue // a failed download, not a film
    usable.push({ name, bytes })
  }
  if (usable.length === 0) throw new Error(`No usable .mp4 files in ${MEDIA_DIR}`)

  /* ---------------- product ---------------- */
  const { rows: product } = await c.query(
    `insert into public.products
       (kind, purpose, title, slug, description, price_minor, status, created_by)
     values ('course', 'vendor_product',
             'DEMO — Player sandbox (not for sale)', $1,
             $2, 0, 'draft', $3)
     returning id`,
    [
      SLUG,
      'A throwaway course for trying the player. Video is Blender Foundation open ' +
        'content (CC-BY). Delete with: node scripts/seed-demo-course.mjs --wipe',
      admin[0].user_id,
    ],
  )
  const productId = product[0].id

  const { rows: section } = await c.query(
    `insert into public.course_sections (product_id, title, position)
     values ($1, 'Try the player', 0) returning id`,
    [productId],
  )
  const sectionId = section[0].id

  let position = 0
  const uploaded = []

  for (const [index, file] of usable.entries()) {
    const key = `${productId}/${crypto.randomUUID()}.mp4`
    await upload(key, file.bytes, 'video/mp4')
    uploaded.push(key)

    /* The FIRST lesson is a preview and carries a checkpoint. Preview so the
       player can be opened without buying anything, and a checkpoint because
       that interaction is the one with no reference anywhere and the one most
       worth seeing work. */
    const isFirst = index === 0
    const { rows: lesson } = await c.query(
      `insert into public.lessons
         (section_id, title, position, kind, storage_path, duration_seconds, is_preview)
       values ($1, $2, $3, 'video', $4, $5, $6) returning id`,
      [
        sectionId,
        isFirst ? `${niceName(file.name)} — with a checkpoint at 4s` : niceName(file.name),
        position++,
        key,
        10,
        isFirst,
      ],
    )

    if (isFirst) {
      const { rows: quiz } = await c.query(
        `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent, position)
         values ($1, 'Quick check', 4, 50, 0) returning id`,
        [lesson[0].id],
      )
      const { rows: question } = await c.query(
        `insert into public.quiz_questions (quiz_id, position, prompt)
         values ($1, 0, 'This checkpoint stopped the video. What happens if you get it wrong?')
         returning id`,
        [quiz[0].id],
      )
      await c.query(
        `insert into public.quiz_options (question_id, position, body, is_correct) values
           ($1, 0, 'You can try again — a checkpoint is not an exam', true),
           ($1, 1, 'The lesson is failed and cannot be retaken', false),
           ($1, 2, 'You are removed from the course', false)`,
        [question[0].id],
      )
    }
  }

  /* An article and a standalone quiz, so all four lesson kinds are present. */
  await c.query(
    `insert into public.lessons (section_id, title, position, kind, body, duration_seconds)
     values ($1, 'A reading lesson', $2, 'article', $3, 0)`,
    [
      sectionId,
      position++,
      `This is what an article lesson looks like. It is stored as text, never as a file — there is no column anywhere that could hold a path to a whole PDF.

A blank line starts a new paragraph, which is the only formatting the reader applies.

Below the text you will find a "Mark as read" button. Reading has no natural end event the way a video does, so it needs a control; it disappears once the lesson is complete, because a button that repeats an action already taken invites the question of whether it worked.`,
    ],
  )

  const { rows: quizLesson } = await c.query(
    `insert into public.lessons (section_id, title, position, kind, duration_seconds)
     values ($1, 'A section quiz', $2, 'quiz', 0) returning id`,
    [sectionId, position++],
  )
  const { rows: sectionQuiz } = await c.query(
    `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent, position)
     values ($1, 'A section quiz', null, 50, 0) returning id`,
    [quizLesson[0].id],
  )
  const { rows: sq } = await c.query(
    `insert into public.quiz_questions (quiz_id, position, prompt)
     values ($1, 0, 'Where is a quiz marked?') returning id`,
    [sectionQuiz[0].id],
  )
  await c.query(
    `insert into public.quiz_options (question_id, position, body, is_correct) values
       ($1, 0, 'On the server — the answer key never reaches the browser', true),
       ($1, 1, 'In the browser, then sent to the server', false)`,
    [sq[0].id],
  )

  const { rows: blockers } = await c.query(
    `select count(*)::int as n, min(problem) as first from public.product_publish_blockers($1)`,
    [productId],
  )

  console.log(
    `demo course created: ${usable.length} video lessons + 1 article + 1 quiz, ` +
      `${blockers[0].n} publish blocker(s)${blockers[0].first ? ` — ${blockers[0].first}` : ''}`,
  )
  console.log(`uploaded ${uploaded.length} files to course-media/${productId}/`)
} catch (error) {
  console.error('FAILED:', error.message)
  process.exitCode = 1
} finally {
  await c.end()
}

function niceName(file) {
  return file
    .replace(/\.mp4$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\d+MB\b|\b\d+s\b|\b360\b/g, '')
    .trim()
}
