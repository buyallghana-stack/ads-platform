/**
 * Real video lessons on the affiliate training, so the player can be seen
 * working (operator, 2026-08-07).
 *
 * Both courses were written entirely as articles and checkpoints, which meant
 * the video path — the poster frame, resume-where-you-stopped, the checkpoint
 * that interrupts at a timestamp, and the Rewatch / Previous / Next panel on
 * the last frame — had never once been exercised against a real file.
 *
 * ── THE FOOTAGE IS BLENDER'S OPEN MOVIES ──
 *
 * Big Buck Bunny and Sintel, both CC-BY from the Blender Foundation, so
 * nothing here needs a licence and nothing has to be taken down later. They
 * are also what the ads side already uses, which keeps one answer to "where
 * did this footage come from".
 *
 * The clips are DOWNLOADED AND UPLOADED to `course-media`, not linked. That
 * bucket is private and every lesson is served through a signed URL that
 * expires in minutes; pointing a lesson at somebody else's CDN would mean the
 * one code path that protects paid content is the one path never tested.
 *
 *   node --env-file=.env.local scripts/seed-video-lessons.mjs
 *   node --env-file=.env.local scripts/seed-video-lessons.mjs --drop
 */
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e
})

const BUCKET = 'course-media'
const PREFIX = 'demo-video'

/** Blender Foundation, CC-BY. 720p, ten seconds, about 2 MB each. */
const CLIPS = [
  {
    slug: 'big-buck-bunny',
    url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_2MB.mp4',
    title: 'Watch this before you promote anything',
    section: 'How this works',
    position: 0,
    seconds: 10,
    /* A checkpoint that interrupts partway, which is the case the player's
       quiz timing exists for and which no lesson currently exercises. */
    checkpointAt: 4,
  },
  {
    slug: 'sintel',
    url: 'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_2MB.mp4',
    title: 'Where your link goes, on screen',
    section: 'Getting your links out',
    position: 0,
    seconds: 10,
    checkpointAt: null,
  },
]

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

await db.connect()
const drop = process.argv.includes('--drop')

try {
  // ---- Remove whatever a previous run left ------------------------------
  const { rows: old } = await db.query(
    `select id, storage_path from public.lessons where storage_path like $1`,
    [`${PREFIX}/%`],
  )
  if (old.length) {
    const ids = old.map((r) => r.id)
    await db.query(`delete from public.lesson_progress where lesson_id = any($1)`, [ids])
    await db.query(
      `delete from public.quiz_options where question_id in (
         select q.id from public.quiz_questions q
          where q.quiz_id in (select id from public.quizzes where lesson_id = any($1)))`,
      [ids],
    )
    await db.query(
      `delete from public.quiz_questions where quiz_id in
         (select id from public.quizzes where lesson_id = any($1))`,
      [ids],
    )
    await db.query(`delete from public.quiz_attempts where quiz_id in
         (select id from public.quizzes where lesson_id = any($1))`, [ids]).catch(() => {})
    await db.query(`delete from public.quizzes where lesson_id = any($1)`, [ids])
    await db.query(`delete from public.lessons where id = any($1)`, [ids])
    await sb.storage.from(BUCKET).remove(old.map((r) => r.storage_path))
    console.log(`removed ${old.length} previous demo video lesson(s)`)
  }

  if (drop) {
    const { rows } = await db.query(
      `select count(*)::int n from public.lessons where storage_path like $1`,
      [`${PREFIX}/%`],
    )
    console.log(`done: ${rows[0].n} demo video lesson(s) remain`)
    process.exit(0)
  }

  // ---- Put them on every course that has the named section --------------
  for (const clip of CLIPS) {
    /* Retried, because one of these two failed mid-run on the first attempt
       and left the course half seeded. A remote host having a bad moment is
       not a reason to leave the catalogue in a state nobody chose. */
    let bytes
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await fetch(clip.url, { signal: AbortSignal.timeout(120_000) })
        if (!response.ok) throw new Error(`returned ${response.status}`)
        bytes = Buffer.from(await response.arrayBuffer())
        break
      } catch (e) {
        if (attempt === 4) throw new Error(`${clip.url}: ${e.message}`)
        console.log(`  … ${clip.slug} attempt ${attempt} failed (${e.message}), retrying`)
        await new Promise((r) => setTimeout(r, attempt * 3000))
      }
    }

    const path = `${PREFIX}/${clip.slug}.mp4`
    const { error: uploadError } = await sb.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'video/mp4', upsert: true })
    if (uploadError) throw uploadError

    /* Every course carrying that section, so both training programmes get one
       rather than only whichever came back first. */
    const { rows: sections } = await db.query(
      `select s.id, p.title
         from public.course_sections s
         join public.products p on p.id = s.product_id
        where s.title = $1`,
      [clip.section],
    )
    if (!sections.length) {
      console.log(`  ! no section named "${clip.section}"; skipped ${clip.slug}`)
      continue
    }

    for (const section of sections) {
      /* Inserted at the FRONT of its section and everything below shifted
         down, because a video that introduces a section belongs before the
         reading, not appended after it. */
      await db.query(
        `update public.lessons set position = position + 1
          where section_id = $1 and position >= $2`,
        [section.id, clip.position],
      )
      const { rows: lesson } = await db.query(
        `insert into public.lessons
           (section_id, title, position, kind, storage_path, duration_seconds, is_preview)
         values ($1, $2, $3, 'video', $4, $5, false)
         returning id`,
        [section.id, clip.title, clip.position, path, clip.seconds],
      )

      if (clip.checkpointAt !== null) {
        const { rows: quiz } = await db.query(
          `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent)
           values ($1, 'Quick check', $2, 100) returning id`,
          [lesson[0].id, clip.checkpointAt],
        )
        const { rows: question } = await db.query(
          `insert into public.quiz_questions (quiz_id, prompt, position)
           values ($1, 'What are you paid on?', 0) returning id`,
          [quiz[0].id],
        )
        for (const [i, [body, correct]] of [
          ['A confirmed sale through your link', true],
          ['Every click your link receives', false],
          ['The number of people who watch this video', false],
        ].entries()) {
          await db.query(
            `insert into public.quiz_options (question_id, body, is_correct, position)
             values ($1, $2, $3, $4)`,
            [question[0].id, body, correct, i],
          )
        }
      }

      console.log(`  + ${clip.title}  →  ${section.title}`)
    }
  }

  const { rows: check } = await db.query(
    `select p.title, count(*)::int n
       from public.lessons l
       join public.course_sections s on s.id = l.section_id
       join public.products p on p.id = s.product_id
      where l.kind = 'video'
      group by p.title order by p.title`,
  )
  console.log('\nvideo lessons per course:')
  check.forEach((r) => console.log(`  ${r.n}  ${r.title}`))
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
