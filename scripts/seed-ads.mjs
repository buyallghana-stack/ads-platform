/**
 * Ad catalogue seed — TEMPORARY, DELETE BEFORE PRODUCTION.
 *
 *   pnpm seed:ads          create any missing sample ads and their media
 *   pnpm seed:ads --force  re-upload the media even if it is already there
 *
 * Split out of seed-dev.mjs because it is the one part worth running on its
 * own: ads are content, not fixtures, and re-running this must never touch the
 * demo ACCOUNTS. It is idempotent by ad title — an ad that already exists is
 * left exactly as it is, including any completions users have earned against
 * it. That is what makes it safe to run against a database somebody is
 * already reviewing.
 *
 * WHAT THIS SET IS FOR
 * --------------------
 * Every branch of the ad model that the player has to handle, so the screen
 * can be reviewed without an admin UI existing yet:
 *
 *   - a YouTube video with TWO questions at admin-chosen cue points
 *   - an uploaded video with one mid-roll question
 *   - an uploaded video with a short-text answer
 *   - a WATCH-ONLY video with no questions at all
 *   - a short survey and a longer multi-question survey
 *
 * The videos are public test clips and the thumbnails are placeholder
 * photography. They stand in for advertiser artwork, which in production
 * arrives from the operator and is uploaded through the admin screens.
 */
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

/* --- env ---------------------------------------------------------------- */
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY

if (!url || !secret) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local')
  process.exit(1)
}

const db = createClient(url, secret, { auth: { persistSession: false } })
const force = process.argv.includes('--force')

const BUCKET = 'ad-media'

/* --- media ---------------------------------------------------------------
 * Fetched once and parked in the ad-media bucket, so the app is not quietly
 * hot-linking somebody else's server on every play. Uploads are skipped when
 * the object already exists — the point of --force is to redo them anyway.
 */
const CLIPS = [
  {
    path: 'seed/accrafresh.mp4',
    from: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
  },
  {
    path: 'seed/kumasi-tiles.mp4',
    from: 'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4',
  },
  {
    path: 'seed/gold-coast-water.mp4',
    from: 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4',
  },
]

/* Placeholder photography, one stable image per ad (the seed in the URL keeps
   it stable, so re-running does not reshuffle every thumbnail). */
const THUMBS = [
  'seed/thumb-accrafresh.jpg',
  'seed/thumb-kumasi-tiles.jpg',
  'seed/thumb-gold-coast-water.jpg',
  'seed/thumb-payments-survey.jpg',
  'seed/thumb-transport-survey.jpg',
].map((path) => ({
  path,
  from: `https://picsum.photos/seed/${path.replace(/[^a-z0-9]/gi, '')}/1280/720`,
}))

async function uploadMedia() {
  const { data: existing } = await db.storage.from(BUCKET).list('seed', { limit: 100 })
  const present = new Set((existing ?? []).map((o) => `seed/${o.name}`))

  for (const item of [...CLIPS, ...THUMBS]) {
    if (present.has(item.path) && !force) {
      console.log(`  media ${item.path} already present — skipping`)
      continue
    }
    const response = await fetch(item.from)
    if (!response.ok) {
      console.warn(`  ! could not fetch ${item.from} (${response.status}) — skipping`)
      continue
    }
    const body = Buffer.from(await response.arrayBuffer())
    const { error } = await db.storage.from(BUCKET).upload(item.path, body, {
      contentType: item.path.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
      upsert: true,
    })
    if (error) throw error
    console.log(`  uploaded ${item.path} (${Math.round(body.length / 1024)} KB)`)
  }
}

/* --- the catalogue -------------------------------------------------------
 *
 * `showAt` is the second of the video at which a question interrupts. Null
 * means "ask at the end". A missing questions array means a watch-only ad,
 * credited on watch time alone.
 *
 * min_watch_seconds is what the server enforces. On a question ad it can be
 * generous, because the question is the real gate; on the watch-only ad it is
 * the ONLY gate, so it is set deliberately rather than left to default.
 */
const ADS = [
  {
    ad: {
      title: 'MTN 4G — more data, same bundle',
      description:
        'Two questions land while this one plays, at the seconds the advertiser asked for.',
      advertiser_name: 'MTN Ghana',
      format: 'video',
      points_reward: 50,
      video_source: 'youtube',
      // The 11-character id, not a full URL — the column stores the id.
      youtube_video_id: 'aqz-KE-bpKQ',
      duration_seconds: 60,
      min_watch_seconds: 15,
      max_completions: 500,
      weight: 140,
      // Left null on purpose: a YouTube ad with no uploaded artwork falls back
      // to YouTube's own still, and that path deserves to be visible here.
      thumbnail_path: null,
    },
    questions: [
      {
        question_text: 'Which network is this advert for?',
        answer_format: 'multiple_choice',
        showAt: 12,
        options: [
          { option_text: 'MTN', is_correct: true },
          { option_text: 'Telecel', is_correct: false },
          { option_text: 'AirtelTigo', is_correct: false },
          { option_text: 'Glo', is_correct: false },
        ],
      },
      {
        question_text: 'What is the advert offering more of?',
        answer_format: 'multiple_choice',
        showAt: 40,
        options: [
          { option_text: 'Data', is_correct: true },
          { option_text: 'Talk time', is_correct: false },
          { option_text: 'Handsets', is_correct: false },
          { option_text: 'Cashback', is_correct: false },
        ],
      },
    ],
  },
  {
    ad: {
      title: 'AccraFresh — market delivery in an hour',
      description: 'One question, halfway through.',
      advertiser_name: 'AccraFresh',
      format: 'video',
      points_reward: 35,
      video_source: 'upload',
      storage_path: 'seed/accrafresh.mp4',
      duration_seconds: 10,
      min_watch_seconds: 5,
      max_completions: 500,
      weight: 100,
      thumbnail_path: 'seed/thumb-accrafresh.jpg',
    },
    questions: [
      {
        question_text: 'How quickly does AccraFresh say it delivers?',
        answer_format: 'multiple_choice',
        showAt: 5,
        options: [
          { option_text: 'Within an hour', is_correct: true },
          { option_text: 'Next day', is_correct: false },
          { option_text: 'Within three days', is_correct: false },
          { option_text: 'Weekends only', is_correct: false },
        ],
      },
    ],
  },
  {
    ad: {
      title: 'Kumasi Tiles — showroom now open',
      description: 'A typed answer rather than a choice.',
      advertiser_name: 'Kumasi Tiles',
      format: 'video',
      points_reward: 40,
      video_source: 'upload',
      storage_path: 'seed/kumasi-tiles.mp4',
      duration_seconds: 10,
      min_watch_seconds: 6,
      max_completions: 500,
      weight: 100,
      thumbnail_path: 'seed/thumb-kumasi-tiles.jpg',
    },
    questions: [
      {
        question_text: 'Type the name of the company in this advert.',
        answer_format: 'short_text',
        // Graded case-insensitively and trimmed, so "kumasi tiles" passes.
        correct_answer: 'Kumasi Tiles',
        showAt: null, // asked at the end
      },
    ],
  },
  {
    ad: {
      title: 'Gold Coast Water — every drop counts',
      description:
        'No questions at all. The advertiser bought attention, not a quiz — watch time is the whole test.',
      advertiser_name: 'Gold Coast Water',
      format: 'video',
      points_reward: 20,
      video_source: 'upload',
      storage_path: 'seed/gold-coast-water.mp4',
      duration_seconds: 10,
      // The only gate on a watch-only ad, so it is set explicitly.
      min_watch_seconds: 8,
      max_completions: 500,
      weight: 90,
      thumbnail_path: 'seed/thumb-gold-coast-water.jpg',
    },
    questions: [],
  },
  {
    ad: {
      title: 'How do you pay for things?',
      description: 'Three quick questions about everyday payments.',
      advertiser_name: 'SidePerks Research',
      format: 'survey',
      points_reward: 80,
      max_completions: 500,
      weight: 110,
      thumbnail_path: 'seed/thumb-payments-survey.jpg',
    },
    questions: [
      {
        question_text: 'Which do you use most often to pay?',
        answer_format: 'multiple_choice',
        options: [
          { option_text: 'Mobile money', is_correct: true },
          { option_text: 'Bank card', is_correct: false },
          { option_text: 'Cash', is_correct: false },
          { option_text: 'Crypto', is_correct: false },
        ],
      },
      {
        question_text: 'Which mobile money service do you use most?',
        answer_format: 'multiple_choice',
        options: [
          { option_text: 'MTN MoMo', is_correct: true },
          { option_text: 'Telecel Cash', is_correct: false },
          { option_text: 'AirtelTigo Money', is_correct: false },
          { option_text: 'I do not use mobile money', is_correct: false },
        ],
      },
      {
        question_text: 'Roughly how often do you send money to someone else?',
        answer_format: 'multiple_choice',
        options: [
          { option_text: 'Weekly', is_correct: true },
          { option_text: 'Daily', is_correct: false },
          { option_text: 'Monthly', is_correct: false },
          { option_text: 'Almost never', is_correct: false },
        ],
      },
    ],
  },
  {
    ad: {
      title: 'Getting around your city',
      description: 'Five questions on how you travel day to day.',
      advertiser_name: 'SidePerks Research',
      format: 'survey',
      points_reward: 120,
      max_completions: 500,
      weight: 80,
      thumbnail_path: 'seed/thumb-transport-survey.jpg',
    },
    questions: [
      {
        question_text: 'How do you usually travel to work or school?',
        answer_format: 'multiple_choice',
        options: [
          { option_text: 'Trotro', is_correct: true },
          { option_text: 'Taxi', is_correct: false },
          { option_text: 'Own car', is_correct: false },
          { option_text: 'On foot', is_correct: false },
        ],
      },
      {
        question_text: 'How long is that journey, one way?',
        answer_format: 'multiple_choice',
        options: [
          { option_text: 'Under 30 minutes', is_correct: true },
          { option_text: '30 to 60 minutes', is_correct: false },
          { option_text: 'Over an hour', is_correct: false },
          { option_text: 'It varies a lot', is_correct: false },
        ],
      },
      {
        question_text: 'Do you book rides through an app?',
        answer_format: 'multiple_choice',
        options: [
          { option_text: 'Sometimes', is_correct: true },
          { option_text: 'Every day', is_correct: false },
          { option_text: 'Never', is_correct: false },
          { option_text: 'I did once', is_correct: false },
        ],
      },
      {
        question_text: 'What would most improve your journey?',
        answer_format: 'multiple_choice',
        options: [
          { option_text: 'Lower fares', is_correct: true },
          { option_text: 'Fewer stops', is_correct: false },
          { option_text: 'Better roads', is_correct: false },
          { option_text: 'More shade at stops', is_correct: false },
        ],
      },
      {
        question_text: 'Type the city or town you travel in most.',
        answer_format: 'short_text',
        correct_answer: 'Accra',
      },
    ],
  },
]

/* --- seed ---------------------------------------------------------------- */

console.log('Seeding ad media…')
await uploadMedia()

// Ads are attributed to the demo admin when there is one; created_by is
// nullable, so a database without the account seed still works.
const { data: admins } = await db.from('user_roles').select('user_id').eq('role', 'admin').limit(1)
const createdBy = admins?.[0]?.user_id ?? null

console.log('Seeding ads…')
for (const { ad, questions } of ADS) {
  const { data: already } = await db.from('ads').select('id').eq('title', ad.title).maybeSingle()
  if (already) {
    console.log(`  ad "${ad.title}" already exists — skipping`)
    continue
  }

  const { data: inserted, error } = await db
    .from('ads')
    .insert({ ...ad, status: 'active', created_by: createdBy })
    .select('id')
    .single()
  if (error) throw error

  for (const [position, question] of questions.entries()) {
    const { options, showAt, ...row } = question
    const { data: q, error: questionError } = await db
      .from('ad_questions')
      .insert({
        ...row,
        ad_id: inserted.id,
        position,
        show_at_seconds: showAt ?? null,
      })
      .select('id')
      .single()
    if (questionError) throw questionError

    if (options) {
      const { error: optionError } = await db
        .from('ad_question_options')
        .insert(options.map((o, i) => ({ ...o, question_id: q.id, sort_order: i })))
      if (optionError) throw optionError
    }
  }

  console.log(
    `  created ${ad.format} "${ad.title}" — ${questions.length} question(s), ${ad.points_reward} pts`,
  )
}

console.log('Done.')
