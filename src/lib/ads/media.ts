import { clientEnv } from '@/lib/env'

/**
 * Public URLs for the `ad-media` bucket.
 *
 * Its own module because both sides need it: the feed builds card thumbnails
 * on the server, and the admin editor previews an upload the moment it lands,
 * in the browser. `lib/ads/data.ts` is `server-only`, so a client component
 * importing this from there is a build error — which is how this file came to
 * exist rather than a second copy of the string being written.
 */

/** Public URL for an object in the `ad-media` bucket. */
export function adMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/ad-media/${path}`
}

/**
 * A cover for a format that has no picture of its own.
 *
 * A video carries its own still, so it never needs one of these. A survey and
 * an article have nothing to take a frame FROM, so without artwork every one
 * of them landed in the feed as the same grey rectangle, which reads as a card
 * that failed to load rather than as a survey.
 *
 * Operator-supplied artwork, 2026-09-23. Cropped to 16:9 at 1280x720 on the
 * way in, because the cover is `object-cover`: cropping here means the
 * composition is chosen rather than left to whatever width the browser
 * happens to give the card, and the bytes a phone downloads on mobile data are
 * the bytes actually shown.
 */
const FORMAT_COVERS: Record<string, string> = {
  survey: '/ads/default-survey.jpg',
  link: '/ads/default-article.jpg',
}

/**
 * Thumbnail for an ad.
 *
 * Order: what the advertiser supplied, then YouTube's own still for a YouTube
 * ad, then the format's own cover, then nothing. "Nothing" is still a real
 * answer for a video without a still, because the card draws a generated cover
 * rather than a broken image frame.
 *
 * `hqdefault` rather than `maxresdefault`: maxres does not exist for every
 * video and 404s to a grey placeholder, while hqdefault always exists.
 *
 * ⚠️ AN UPLOAD ALWAYS WINS. The format cover is the LAST resort, so the moment
 * an operator puts real artwork on a survey it replaces this and never
 * competes with it.
 */
export function adThumbnailUrl(row: {
  thumbnail_path?: string | null
  youtube_video_id?: string | null
  format?: string | null
}): string | null {
  const uploaded = adMediaUrl(row.thumbnail_path)
  if (uploaded) return uploaded
  if (row.youtube_video_id) return `https://i.ytimg.com/vi/${row.youtube_video_id}/hqdefault.jpg`
  if (row.format) return FORMAT_COVERS[row.format] ?? null
  return null
}
