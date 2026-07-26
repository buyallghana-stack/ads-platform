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
 * Thumbnail for an ad.
 *
 * Order: what the advertiser supplied, then YouTube's own still for a YouTube
 * ad, then nothing — and "nothing" is a real answer, because the card draws a
 * generated cover rather than a broken image frame. An ad the operator has not
 * yet uploaded artwork for still looks deliberate.
 *
 * `hqdefault` rather than `maxresdefault`: maxres does not exist for every
 * video and 404s to a grey placeholder, while hqdefault always exists.
 */
export function adThumbnailUrl(row: {
  thumbnail_path?: string | null
  youtube_video_id?: string | null
}): string | null {
  const uploaded = adMediaUrl(row.thumbnail_path)
  if (uploaded) return uploaded
  if (row.youtube_video_id) return `https://i.ytimg.com/vi/${row.youtube_video_id}/hqdefault.jpg`
  return null
}
