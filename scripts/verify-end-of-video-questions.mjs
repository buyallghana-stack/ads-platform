/**
 * Two questions at the END of a video: does the second one follow the first?
 *
 * WHY THIS EXISTS. Operator, 2026-08-13, on a video ad in the Bronze bucket:
 *
 *   "the video ended and a question came, i answered and instead of a follow
 *    up question, the ad started for the ad to end before i could answer the
 *    next question."
 *
 * AdPlayer had one rule for "there are questions left to ask": go back to the
 * video and let the clock raise them. True for a cue in the future. Ruinous
 * once the film has finished, because asking a FINISHED player to play does
 * not resume it, it REWINDS it — YouTube's playVideo() on an ENDED player and
 * a plain <video>'s play() after `ended` both restart from zero. So answering
 * the first end-of-film question replayed the whole advert, and the second
 * question could not be reached until it had run again.
 *
 * ── WHY A BROWSER AND NOT JUST THE UNIT TEST ──
 *
 * tests/ads/question-order.test.ts pins the RULE (nextDueQuestion). It cannot
 * see the thing the operator actually saw, which is a video element winding
 * itself back to 0. That is a property of the media element, not of the rule,
 * so this asserts it where it happens: currentTime before the answer, and
 * currentTime after it.
 *
 * ── THE VIDEO ──
 *
 * There is no ffmpeg on this machine and Playwright's Chromium cannot decode
 * H.264, so the clip is RECORDED BY THE BROWSER ITSELF: a canvas, captureStream
 * and MediaRecorder produce a two-second VP8/WebM that the same Chromium is
 * guaranteed to play back. It is uploaded to the ad-media bucket, used, and
 * deleted with the ad in the finally.
 *
 *   node --env-file=.env.local scripts/verify-end-of-video-questions.mjs
 *   BASE=http://localhost:3100 SHOTS=/tmp/shots node --env-file=... (as above)
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const SHOTS = process.env.SHOTS ?? ''
const BUCKET = 'ad-media'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const stamp = Date.now()
const EMAIL = `endq-${stamp}@test.invalid`
const PASSWORD = `EndQ!${stamp}`
const CLIP = `verify/end-questions-${stamp}.webm`
const TITLE = `VERIFY two end questions ${stamp}`
const Q1 = 'Which of these did you notice first?'
const Q2 = 'And would you watch another one?'

let userId = null
let adId = null
let browser = null

await db.connect()

/** Record a short clip in the browser, so the codec is one it can play. */
async function recordClip(page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')
    const stream = canvas.captureStream(25)
    const chunks = []
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
    rec.ondataavailable = (e) => chunks.push(e.data)

    const done = new Promise((resolve) => {
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' })
        const buf = await blob.arrayBuffer()
        let binary = ''
        for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte)
        resolve(btoa(binary))
      }
    })

    rec.start()
    // Something has to actually change per frame or the encoder emits almost
    // nothing and the file has no usable duration.
    const started = performance.now()
    await new Promise((resolve) => {
      const draw = () => {
        const t = performance.now() - started
        ctx.fillStyle = `hsl(${(t / 8) % 360} 70% 45%)`
        ctx.fillRect(0, 0, 320, 180)
        ctx.fillStyle = '#fff'
        ctx.font = '20px sans-serif'
        ctx.fillText(`${(t / 1000).toFixed(1)}s`, 20, 100)
        if (t >= 2000) {
          rec.stop()
          resolve()
          return
        }
        requestAnimationFrame(draw)
      }
      draw()
    })
    return done
  })
  return Buffer.from(base64, 'base64')
}

/** The question on screen, if any, and where the video is up to. */
const state = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]')
    const heading = root?.querySelector('h2, h3, p.font-semibold')
    const sheet = [...(root?.querySelectorAll('*') ?? [])].find(
      (el) => el.children.length === 0 && /\?$/.test((el.textContent || '').trim()),
    )
    const video = document.querySelector('video')
    /* Disabled buttons are KEPT. The submit button is disabled until an option
       is chosen, and its LABEL is one of the things under test — filtering it
       out is how the first run of this script read it as `undefined`. */
    const buttons = [...(root?.querySelectorAll('button') ?? [])]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => ({
        text: (b.textContent || '').trim().slice(0, 40) || '(icon)',
        label: b.getAttribute('aria-label'),
        role: b.getAttribute('role'),
        disabled: b.disabled,
      }))
    return {
      question: sheet ? sheet.textContent.trim() : null,
      heading: heading ? heading.textContent.trim() : null,
      submitLabel: (root?.querySelector('form button[type="submit"]')?.textContent || '').trim(),
      currentTime: video ? Number(video.currentTime.toFixed(2)) : null,
      paused: video ? video.paused : null,
      ended: video ? video.ended : null,
      buttons,
    }
  })

/** Answer the question on screen and press whatever the submit button says. */
const answer = async (page, optionText) => {
  await page.getByRole('radio', { name: new RegExp(optionText, 'i') }).click()
  await page.waitForTimeout(200)
  const label = (await state(page)).submitLabel
  await page.locator('[role="dialog"] form button[type="submit"]').click()
  return label
}

try {
  // ---- Fixture ----------------------------------------------------------
  browser = await chromium.launch()
  const recorder = await browser.newContext()
  const scratch = await recorder.newPage()
  await scratch.goto('about:blank')
  const clip = await recordClip(scratch)
  await recorder.close()
  check('a playable clip was recorded', clip.length > 1000, `${clip.length} bytes of webm`)

  const upload = await sb.storage
    .from(BUCKET)
    .upload(CLIP, clip, { contentType: 'video/webm', upsert: true })
  if (upload.error) throw upload.error

  const ad = await db.query(
    `insert into public.ads
       (title, description, advertiser_name, format, status, points_reward,
        video_source, storage_path, duration_seconds, min_watch_seconds, weight)
     values ($1, 'Temporary fixture for verify-end-of-video-questions.', 'Verify',
             'video', 'active', 100, 'upload', $2, 2, 0, 100)
     returning id`,
    [TITLE, CLIP],
  )
  adId = ad.rows[0].id

  /* BOTH questions with show_at_seconds NULL — "ask it at the end", which is
     exactly the arrangement the operator's ad used. */
  for (const [position, text] of [Q1, Q2].entries()) {
    const q = await db.query(
      `insert into public.ad_questions (ad_id, position, question_text, answer_format, show_at_seconds)
       values ($1, $2, $3, 'multiple_choice', null) returning id`,
      [adId, position, text],
    )
    await db.query(
      `insert into public.ad_question_options (question_id, option_text, is_correct, sort_order)
       values ($1, 'The colour', false, 0), ($1, 'The timer', false, 1)`,
      [q.rows[0].id],
    )
  }

  const { data: created, error: userError } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'End Question Tester' },
  })
  if (userError) throw userError
  userId = created.user.id

  // ---- Walk it ----------------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

  await page.goto(`${BASE}/ads`, { waitUntil: 'networkidle' })
  const card = page.locator('li button', { hasText: TITLE.slice(0, 24) }).first()
  await card.waitFor({ timeout: 15_000 })
  await card.click()
  await page.waitForTimeout(1200)

  const play = page.getByRole('button', { name: /tap to play/i })
  await play.click()
  check('the clip plays', true, 'tapped through the autoplay gate')

  // The film is two seconds. Wait for the end event to have been and gone.
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video')
      return Boolean(v && (v.ended || v.currentTime > 1.5))
    },
    { timeout: 20_000 },
  )
  await page.waitForTimeout(1200)

  const first = await state(page)
  check('the first question opens when the film ends', first.question === Q1, first.question ?? 'no question on screen')
  check('the film really did reach its end', (first.currentTime ?? 0) > 1.2, `currentTime ${first.currentTime}`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/end-questions-1.png` })

  // Answer it, and see what the button promised on the way through. On a
  // finished film "Continue watching" is a lie — there is nothing left to
  // watch, and the old build both said it and then acted on it.
  const label = await answer(page, 'the colour')
  check(
    'the button does not promise more video',
    !/continue watching|regarder/i.test(label),
    `it reads "${label}"`,
  )
  await page.waitForTimeout(900)

  const second = await state(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/end-questions-2.png` })

  // ---- The two assertions the bug failed --------------------------------
  check(
    'the SECOND question follows immediately',
    second.question === Q2,
    second.question ?? `nothing asked; on screen: ${second.heading ?? 'video'}`,
  )
  check(
    'the advert did not rewind and replay',
    (second.currentTime ?? 0) > 1.2,
    `currentTime went ${first.currentTime} → ${second.currentTime}`,
  )

  // And it can still be finished.
  await answer(page, 'the timer')
  await page.waitForTimeout(3500)
  const done = await state(page)
  check(
    'the ad reaches a result',
    done.buttons.some((b) => /done|next ad|back to ads|try again/i.test(b.text)),
    done.buttons.map((b) => b.text).join(' | '),
  )

  const answered = await db.query(
    `select count(*)::int n from public.ad_responses where ad_id = $1 and user_id = $2`,
    [adId, userId],
  )
  check('both answers were recorded', answered.rows[0].n === 2, `${answered.rows[0].n} row(s)`)

  check('no page errors', errors.length === 0, errors.join(' | ') || 'clean')
} finally {
  // ---- Leave nothing behind ---------------------------------------------
  if (adId) await db.query('delete from public.ads where id = $1', [adId])
  await sb.storage.from(BUCKET).remove([CLIP])

  /*
    The test user FINISHED an ad, so it has a points_ledger row — and that
    table is append-only by trigger and RESTRICTs the profile behind it, so
    auth.admin.deleteUser() returns an error rather than deleting anything and
    the account survives the run. The first three runs of this script each left
    an orphan on the live database exactly that way.

    So the credit is removed with the trigger off, in one transaction, and the
    trigger goes back on in the same transaction whatever happens. This is the
    same manoeuvre reset-user-data.mjs makes, for the same reason.
  */
  if (userId) {
    try {
      await db.query('begin')
      await db.query('alter table public.points_ledger disable trigger user')
      await db.query('delete from public.points_ledger where user_id = $1', [userId])
      await db.query('alter table public.points_ledger enable trigger user')
      await db.query('delete from public.user_balances where user_id = $1', [userId])
      await db.query('commit')
    } catch (e) {
      await db.query('rollback')
      console.log(`  could not clear the test ledger: ${e.message}`)
    }
    const gone = await sb.auth.admin.deleteUser(userId)
    if (gone.error) console.log(`  LEFT BEHIND: ${EMAIL} — ${gone.error.message}`)
  }

  if (browser) await browser.close()
  await db.end()

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log(failed.map((r) => `  FAIL  ${r.name}`).join('\n'))
    process.exitCode = 1
  }
}
