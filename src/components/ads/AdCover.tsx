import { ListChecks, Play } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * The image on an ad card.
 *
 * A thumbnail is supplied by the advertiser and stored on the ad, but three
 * situations leave us without one: the operator has not uploaded it yet, a
 * survey has no natural still, or YouTube's own thumbnail fails to load on a
 * bad connection. A broken image frame in the middle of a feed makes the whole
 * product look unfinished, so the fallback is a GENERATED cover instead —
 * a brand-family gradient picked deterministically from the ad's id, with the
 * format's icon on it.
 *
 * Deterministic matters: the same ad keeps the same cover between renders and
 * between sessions, so the feed does not shimmer with new colours on every
 * refresh, and a user recognises an ad they already scrolled past.
 */

/*
  Five covers, all inside the brand blue -> accent family plus the two
  neighbouring accents, so a screen of fallbacks still reads as one product.
  Deliberately not the full accent palette: violet means "plans" and orange
  means "referrals" platform-wide, and a cover is not either of those.
*/
const COVERS = [
  'from-brand-700 via-brand-600 to-(--color-brand-accent)',
  'from-brand-800 via-brand-700 to-brand-500',
  'from-ink-800 via-brand-800 to-brand-600',
  'from-brand-600 via-(--color-brand-accent) to-brand-500',
  'from-brand-900 via-brand-700 to-(--color-brand-accent)',
] as const

/** Stable small hash of the id — same ad, same cover, every time. */
function coverIndex(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 100000
  return h % COVERS.length
}

export function AdCover({
  seed,
  src,
  title,
  format,
  className,
}: {
  /** The ad id. Picks the fallback gradient. */
  seed: string
  src: string | null
  title: string
  format: 'video' | 'survey'
  className?: string
}) {
  const Icon = format === 'video' ? Play : ListChecks

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden bg-gradient-to-br',
        COVERS[coverIndex(seed)],
        className,
      )}
    >
      {src && (
        /* Plain <img>: these are Supabase public URLs and YouTube stills, and
           next/image would need per-host remote config for a feed thumbnail.
           If it fails to load the gradient underneath is already the fallback,
           so nothing has to be handled. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      )}

      {!src && (
        <span aria-hidden className="absolute inset-0 grid place-items-center">
          <Icon className="size-10 text-white/25" strokeWidth={1.5} />
        </span>
      )}

      {/* Scrim. Always present, image or not — every overlay on top of this
          (title, duration, reward) has to stay legible over an unknown
          photograph, and a scrim is the only thing that guarantees it. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/5"
      />

      <span className="sr-only">{title}</span>
    </div>
  )
}
