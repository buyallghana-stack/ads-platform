/**
 * Shrink a chosen photo to what an avatar actually needs, in the browser,
 * before a byte of it is uploaded.
 *
 * WHY IN THE BROWSER. The operator's own profile picture was a 1.26 MB PNG,
 * and every screen that shows a list of people — the leaderboard, the team,
 * the admin's people grid — downloads one of these per row. On a Ghanaian
 * mobile connection that is the difference between a list and a wait.
 * Compressing here means the slow upload never happens either: the person
 * sending the photo is on the same connection as the people who will fetch it.
 *
 * THE NUMBERS, AND WHERE THEY COME FROM. The largest an avatar is ever drawn
 * is 96 CSS pixels (the profile page); everywhere else is 40 or less. At a 3×
 * device pixel ratio that is 288 real pixels, so 320 is the first round number
 * that cannot look soft. WebP at 0.82 puts a 320px portrait at roughly 15–25 KB
 * — two orders of magnitude off where we were.
 *
 * IT NEVER BLOCKS A SAVE. Every failure path returns the original file rather
 * than throwing: an old browser that cannot decode into a canvas should still
 * be able to set a profile picture. The caller keeps a size limit for that
 * case, and the bucket has its own ceiling, so "compression did not happen"
 * can never mean "anything at all was uploaded".
 */

/** The longest edge we keep. See the note above for why 320 and not 96. */
const TARGET_PX = 320

/** Good enough to stop at. Anything under this is already a rounding error on
 *  a page that loads a dozen of them. */
const MAX_BYTES = 60 * 1024

/** Tried in order, stopping at the first that fits. Starting low would make
 *  every photo worse to save bytes nobody notices. */
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.5]

type Loaded = {
  image: CanvasImageSource
  width: number
  height: number
  release: () => void
}

export async function compressAvatar(file: File): Promise<File> {
  let source: Loaded
  try {
    source = await loadImage(file)
  } catch {
    return file
  }

  try {
    if (!source.width || !source.height) return file

    /*
      A CENTRED SQUARE, cropped here rather than left to `object-cover` in CSS.
      Every avatar is drawn in a circle, so the sides of a landscape photo are
      never seen — uploading them is paying to transfer pixels that are
      guaranteed to be thrown away.
    */
    const side = Math.min(source.width, source.height)
    // Never upscale: a 64px picture stays 64px rather than being blown up to
    // 320 and re-encoded, which only adds bytes and blur.
    const size = Math.min(TARGET_PX, side)

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(
      source.image,
      (source.width - side) / 2,
      (source.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    )

    /*
      WebP where it exists, JPEG where it does not. Asking for a format the
      browser cannot encode does NOT throw — `toBlob` quietly hands back a PNG,
      which for a photograph is far bigger than what we started from. So the
      answer is read off the blob's own type rather than sniffed from the user
      agent.
    */
    let type = 'image/webp'
    let blob = await toBlob(canvas, type, QUALITY_STEPS[0])
    if (!blob || blob.type !== type) {
      type = 'image/jpeg'
      blob = await toBlob(canvas, type, QUALITY_STEPS[0])
    }

    for (const quality of QUALITY_STEPS.slice(1)) {
      if (blob && blob.size <= MAX_BYTES) break
      const next = await toBlob(canvas, type, quality)
      if (next) blob = next
    }

    if (!blob) return file
    // A small PNG logo can come out bigger than it went in. Keep whichever is
    // actually smaller — the point is bytes on the wire, not the format.
    if (blob.size >= file.size) return file

    return new File([blob], `avatar.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type })
  } catch {
    return file
  } finally {
    source.release()
  }
}

/**
 * The picture, decoded, the right way up.
 *
 * `createImageBitmap` with `imageOrientation: 'from-image'` is what applies the
 * EXIF rotation a phone camera writes — without it, portrait photos from an
 * iPhone land on their side. It arrived in Safari 15, and this app supports
 * back to iOS 12, so the `<img>` path is the fallback rather than an
 * afterthought.
 */
async function loadImage(file: File): Promise<Loaded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // Some browsers have the function but refuse the options bag. Fall
      // through to the element, which they all have.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('The image could not be decoded.'))
      el.src = url
    })
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}
