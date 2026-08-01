/**
 * Shrink the profile pictures that were uploaded before the browser started
 * doing it — the operator's own was a 1.26 MB PNG.
 *
 * Uploads now compress on the client (src/lib/profile/compress-image.ts), so
 * this is a one-off catch-up rather than something to run on a schedule. It is
 * kept because the same job comes back the moment anything writes an avatar
 * from outside the browser — a bulk import, a seed, a support tool.
 *
 * IT WRITES A NEW OBJECT RATHER THAN OVERWRITING. Two reasons: the extension
 * has to change with the format, and a public URL that is already in a CDN
 * cache would otherwise keep serving the old bytes for as long as that cache
 * lives. New path, profile updated, old object deleted — the same three steps
 * the app itself performs when somebody replaces their photo.
 *
 *   node --env-file=.env.local scripts/compress-existing-avatars.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const DRY = process.argv.includes('--dry')

/* The same rules as the browser: a centred square, 320px, WebP. See
   compress-image.ts for why 320 is the number. */
const TARGET_PX = 320
const QUALITY = 82
/* Anything already smaller than this is left alone — re-encoding a small
   picture costs quality and saves nothing worth having. */
const LEAVE_ALONE_BYTES = 60 * 1024

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

const { data: profiles, error } = await db
  .from('profiles')
  .select('id, full_name, avatar_path')
  .not('avatar_path', 'is', null)

if (error) throw error

console.log(`${profiles.length} profile(s) with a picture\n`)

let shrunk = 0
let saved = 0

for (const profile of profiles) {
  const path = profile.avatar_path
  const label = `${profile.full_name ?? profile.id}`

  const { data: file, error: downloadError } = await db.storage.from('avatars').download(path)
  if (downloadError || !file) {
    console.log(`  SKIP  ${label} — could not download ${path}: ${downloadError?.message}`)
    continue
  }

  const original = Buffer.from(await file.arrayBuffer())
  if (original.byteLength <= LEAVE_ALONE_BYTES) {
    console.log(`  keep  ${label} — already ${kb(original.byteLength)}`)
    continue
  }

  const compressed = await sharp(original)
    // `rotate()` with no argument applies the EXIF orientation, which is what
    // stops a phone's portrait photo landing on its side.
    .rotate()
    .resize(TARGET_PX, TARGET_PX, { fit: 'cover', position: 'centre', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer()

  if (compressed.byteLength >= original.byteLength) {
    console.log(`  keep  ${label} — compressing made it bigger`)
    continue
  }

  const next = `${profile.id}/${crypto.randomUUID()}.webp`
  console.log(
    `  ${DRY ? 'would shrink' : 'shrink'}  ${label} — ${kb(original.byteLength)} → ${kb(compressed.byteLength)}`,
  )
  saved += original.byteLength - compressed.byteLength
  shrunk += 1
  if (DRY) continue

  const { error: uploadError } = await db.storage
    .from('avatars')
    .upload(next, compressed, { contentType: 'image/webp', upsert: false })
  if (uploadError) {
    console.log(`  FAILED ${label} — upload: ${uploadError.message}`)
    continue
  }

  // The profile points at the new file BEFORE the old one goes, so a failure
  // here leaves an unused object rather than a profile pointing at nothing.
  const { error: updateError } = await db
    .from('profiles')
    .update({ avatar_path: next })
    .eq('id', profile.id)
  if (updateError) {
    await db.storage.from('avatars').remove([next])
    console.log(`  FAILED ${label} — profile: ${updateError.message}`)
    continue
  }

  await db.storage.from('avatars').remove([path])
}

console.log(
  `\n${DRY ? 'would shrink' : 'shrank'} ${shrunk} picture(s), saving ${kb(saved)} in total`,
)

/* Read back from the bucket rather than trusting the arithmetic above. */
const { data: after } = await db.from('profiles').select('id, avatar_path').not('avatar_path', 'is', null)
let total = 0
for (const row of after ?? []) {
  const folder = row.avatar_path.split('/')[0]
  const { data: objects } = await db.storage.from('avatars').list(folder)
  const match = (objects ?? []).find((o) => `${folder}/${o.name}` === row.avatar_path)
  const bytes = match?.metadata?.size ?? 0
  total += bytes
  console.log(`  ${row.avatar_path} — ${kb(bytes)}`)
}
console.log(`bucket now holds ${kb(total)} of profile pictures across ${(after ?? []).length} account(s)`)
