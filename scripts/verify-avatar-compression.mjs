/**
 * A profile picture chosen in the browser must reach storage as a few
 * kilobytes, not a few megabytes.
 *
 * WHY THIS IS A SCRIPT AND NOT A UNIT TEST. The compression happens in a real
 * canvas, in a real browser, on a real file the user picked — `canvas.toBlob`,
 * WebP support and EXIF orientation are all browser behaviour, and a mocked
 * canvas would prove nothing about any of them. So this drives the actual
 * profile screen with an actual multi-megabyte photograph and then asks
 * STORAGE what it received.
 *
 * The operator's own picture was a 1.26 MB PNG that "takes time to load", on
 * screens that show a dozen avatars at once.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import sharp from 'sharp'

const BASE = process.env.BASE ?? 'http://localhost:3100'

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
const EMAIL = `avatar-${stamp}@test.invalid`
const PASSWORD = `Avatar!${stamp}`
let userId = null
let browser = null

await db.connect()

const stored = async () => {
  const { rows } = await db.query(
    `select p.avatar_path,
            (o.metadata->>'size')::bigint as bytes,
            o.metadata->>'mimetype' as mime
       from public.profiles p
       left join storage.objects o
         on o.bucket_id = 'avatars' and o.name = p.avatar_path
      where p.id = $1`,
    [userId],
  )
  return rows[0] ?? {}
}

try {
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Avatar Tester' },
  })
  if (error) throw error
  userId = data.user.id

  /*
    A photograph, not a flat colour: noise is what makes a JPEG big, and a
    2000x1500 block of one colour would compress to nothing whatever the code
    did — a test that cannot fail. This one lands around 2 MB.
  */
  const noise = Buffer.alloc(2400 * 1800 * 3)
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256)
  const photo = await sharp(noise, { raw: { width: 2400, height: 1800, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer()
  console.log(`the chosen photo is ${(photo.length / 1024 / 1024).toFixed(2)} MB, 2400x1800\n`)

  browser = await chromium.launch()
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

  await page.goto(`${BASE}/profile/personal`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type="file"]', {
    name: 'holiday.jpg',
    mimeType: 'image/jpeg',
    buffer: photo,
  })
  await page.getByText(/photo saved/i).waitFor({ timeout: 60_000 })
  check('the picture uploads through the real screen', true, 'confirmation shown')

  const after = await stored()
  check('the profile points at a stored object', Boolean(after.avatar_path && after.bytes), after.avatar_path)
  check(
    'it was compressed to a few kilobytes',
    Number(after.bytes) > 0 && Number(after.bytes) < 60 * 1024,
    `${(Number(after.bytes) / 1024).toFixed(1)} KB, from ${(photo.length / 1024).toFixed(0)} KB`,
  )
  check('it was re-encoded, not just renamed', after.mime === 'image/webp', after.mime)
  check(
    'the path carries the real format',
    String(after.avatar_path).endsWith('.webp'),
    after.avatar_path,
  )

  /* What the page actually renders — polled until the image has decoded.
     Avatars are `loading="lazy"`, so naturalWidth is 0 for a moment after the
     src changes, and reading it too early measures nothing. */
  const shown = await page
    .waitForFunction(
      () => {
        const img = document.querySelector('img[src*="/avatars/"]')
        return img && img.naturalWidth > 0
          ? { src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight }
          : null
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null)
  check('the picture renders', Boolean(shown?.w), shown ? `${shown.w}x${shown.h}` : 'no image')
  check(
    'it is stored at avatar size, not photo size',
    shown?.w === 320 && shown?.h === 320,
    shown ? `${shown.w}x${shown.h}` : 'unknown',
  )

  // Replacing it must not leave the old one behind.
  const first = after.avatar_path
  await page.setInputFiles('input[type="file"]', {
    name: 'second.jpg',
    mimeType: 'image/jpeg',
    buffer: photo,
  })
  await page.waitForTimeout(4000)
  const second = await stored()
  const { rows: leftovers } = await db.query(
    `select count(*)::int n from storage.objects
      where bucket_id = 'avatars' and name like $1 || '/%'`,
    [userId],
  )
  check('replacing the picture leaves exactly one object', leftovers[0].n === 1, `${leftovers[0].n} object(s)`)
  check('and it is the new one', second.avatar_path !== first, second.avatar_path)

  check('no page errors', errors.length === 0, errors[0])

  console.log('')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  try {
    if (userId) {
      const { data: objects } = await sb.storage.from('avatars').list(userId)
      if (objects?.length) {
        await sb.storage.from('avatars').remove(objects.map((o) => `${userId}/${o.name}`))
      }
      await db.query(`delete from auth.users where id = $1`, [userId])
    }
    const { rows } = await db.query(
      `select (select count(*)::int from auth.users where id = $1) users,
              (select count(*)::int from storage.objects
                where bucket_id = 'avatars' and name like $1 || '/%') objects`,
      [userId],
    )
    console.log(`cleanup: ${rows[0].users} user(s), ${rows[0].objects} object(s) left`)
    if (rows[0].users !== 0 || rows[0].objects !== 0) process.exitCode = 1
  } catch (e) {
    console.error('CLEANUP FAILED —', e.message, '| user:', userId)
    process.exitCode = 1
  }
  await db.end()
}
