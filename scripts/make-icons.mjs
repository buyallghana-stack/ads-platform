/**
 * Browser and OS icons, generated from the one source mark.
 *
 * Kept as a script rather than done by hand so the icons can be regenerated
 * from `public/sideperks-mark.png` if the logo ever changes — three files
 * edited in an image editor drift apart, a script cannot.
 *
 * Next's App Router picks these up by filename convention:
 *   src/app/favicon.ico     classic tab icon, multi-size
 *   src/app/icon.png        modern browsers, chosen over the .ico when present
 *   src/app/apple-icon.png  iOS home screen
 *
 * The .ico is assembled by hand because sharp cannot write the format. An ICO
 * is a small header plus a directory of embedded images; since Vista those
 * images may themselves be PNGs, which is what this writes.
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

const SRC = 'public/sideperks-mark.png'

/* `ensureAlpha` is load-bearing: the source mark has no alpha channel, so
   sharp writes RGB PNGs — and Turbopack refuses to decode an .ico whose
   embedded PNGs are not RGBA ("The PNG is not in RGBA format!"). */
const png = (size) =>
  sharp(SRC).resize(size, size, { fit: 'cover' }).ensureAlpha().png({ compressionLevel: 9 }).toBuffer()

// ---- Modern icons ---------------------------------------------------------
writeFileSync('src/app/icon.png', await png(512))
writeFileSync('src/app/apple-icon.png', await png(180))

// ---- favicon.ico ----------------------------------------------------------
const sizes = [16, 32, 48]
const images = await Promise.all(sizes.map(png))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)            // reserved
header.writeUInt16LE(1, 2)            // type 1 = icon
header.writeUInt16LE(sizes.length, 4) // image count

const entries = []
let offset = 6 + sizes.length * 16

sizes.forEach((size, i) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(size === 256 ? 0 : size, 0) // width  (0 means 256)
  e.writeUInt8(size === 256 ? 0 : size, 1) // height
  e.writeUInt8(0, 2)                       // palette count
  e.writeUInt8(0, 3)                       // reserved
  e.writeUInt16LE(1, 4)                    // colour planes
  e.writeUInt16LE(32, 6)                   // bits per pixel
  e.writeUInt32LE(images[i].length, 8)     // size of the payload
  e.writeUInt32LE(offset, 12)              // where it starts
  offset += images[i].length
  entries.push(e)
})

writeFileSync('src/app/favicon.ico', Buffer.concat([header, ...entries, ...images]))

console.log('icon.png        512x512')
console.log('apple-icon.png  180x180')
console.log('favicon.ico    ', sizes.join(', '), '=', Buffer.concat([header, ...entries, ...images]).length, 'bytes')
