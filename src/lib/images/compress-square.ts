/**
 * Shrink a chosen picture to what it is actually drawn at, in the browser,
 * before a byte of it is uploaded.
 *
 * WHY IN THE BROWSER. The person choosing the file is on the same connection
 * as everybody who will later download it. A 1.26 MB PNG (the size of the
 * operator's own profile photo, which is where this module started) costs the
 * uploader a slow upload and then costs every viewer the download, on a
 * Ghanaian mobile connection, once per card on the screen. Resizing here
 * means neither happens.
 *
 * WHAT IT IS USED FOR NOW. Advertiser logos on the ad cards. Profile photos
 * were withdrawn on 2026-09-21 and everybody is drawn as their initials, so
 * the avatar path this was written for is gone; the code moved here rather
 * than being deleted with it because the problem it solves is the same one an
 * advertiser logo has, and it had already been debugged against real phones.
 *
 * IT NEVER BLOCKS A SAVE. Every failure path returns the ORIGINAL file rather
 * than throwing: an old browser that cannot decode into a canvas should still
 * be able to set a logo. The caller keeps its own size limit for that case,
 * and the bucket has a ceiling of its own, so "compression did not happen"
 * can never mean "anything at all was uploaded".
 */

export type SquareOptions = {
  /**
   * The longest edge to keep, in real pixels.
   *
   * Work it out from the largest the picture is ever DRAWN, times a device
   * pixel ratio of 3: an advertiser logo is 32 CSS pixels on the player, so
   * 96 is the first round number that cannot look soft.
   */
  targetPx: number
  /** Good enough to stop at. Below this, more compression buys nothing. */
  maxBytes: number
  /** Base name for the produced file. The extension is added here. */
  name: string
}

/** Tried in order, stopping at the first that fits. Starting low would make
 *  every picture worse to save bytes nobody notices. */
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.5]

type Loaded = {
  image: CanvasImageSource
  width: number
  height: number
  release: () => void
}

/**
 * A centred square, resized and re-encoded.
 *
 * Cropped here rather than left to `object-cover` in CSS: the mark is drawn
 * in a square or a circle, so the sides of a landscape picture are never
 * seen, and uploading them is paying to transfer pixels that are guaranteed
 * to be thrown away.
 */
export async function compressSquareImage(file: File, options: SquareOptions): Promise<File> {
  let source: Loaded
  try {
    source = await loadImage(file)
  } catch {
    return file
  }

  try {
    if (!source.width || !source.height) return file

    const side = Math.min(source.width, source.height)
    // Never upscale: a 64px picture stays 64px rather than being blown up to
    // the target and re-encoded, which only adds bytes and blur.
    const size = Math.min(options.targetPx, side)

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
      if (blob && blob.size <= options.maxBytes) break
      const next = await toBlob(canvas, type, quality)
      if (next) blob = next
    }

    if (!blob) return file
    // A small PNG logo can come out bigger than it went in. Keep whichever is
    // actually smaller — the point is bytes on the wire, not the format.
    if (blob.size >= file.size) return file

    return new File([blob], `${options.name}.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type })
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
