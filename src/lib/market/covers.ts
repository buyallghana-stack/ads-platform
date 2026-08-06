/**
 * Where a product cover lives.
 *
 * `product-covers` is PUBLIC, unlike `course-media`, and the distinction is the
 * whole point: a cover has to be readable by a signed-out stranger following an
 * affiliate link, and it is fetched once per card on a browse screen. Signed
 * URLs would defeat CDN caching and add a round trip per card on a mobile
 * connection, to hide an image whose entire job is to be seen.
 *
 * Paid lesson media stays private and keeps its 15-minute signed links.
 */
export function coverUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  return `${base}/storage/v1/object/public/product-covers/${path}`
}

/** "1h 20m", "45m", or null when nothing has a duration yet. */
export function courseLength(seconds: number): string | null {
  if (!seconds || seconds < 60) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
