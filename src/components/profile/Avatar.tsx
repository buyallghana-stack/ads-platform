import { initials } from '@/lib/profile/avatar'
import { cn } from '@/lib/cn'

/**
 * Profile avatar. Shows the user's picture when one is set, otherwise a
 * gradient circle with their initials — so a new account always has a
 * recognisable mark, and it's replaced the moment a photo is uploaded.
 *
 * The caller sizes it (size-* on className) and, for the initials fallback,
 * sets the text size in the same className so the letters scale with the ring.
 */
export function Avatar({
  name,
  src,
  className,
}: {
  name?: string | null
  src?: string | null
  className?: string
}) {
  if (src) {
    return (
      // Supabase public URL; next/image would need per-host remote config for
      // a 40px avatar that isn't worth it.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        /* Avatars are stored at whatever size the person uploaded — the
           operator's own is 1.26 MB — and the leaderboard is the first screen
           that shows many at once. Lazy + async means a phone downloads the
           handful on screen instead of a hundred, which is the difference
           between a slow list and an unusable one on a Ghanaian connection.
           It does NOT fix the underlying size; resizing on upload does, and
           that belongs with the avatar upload path. */
        loading="lazy"
        decoding="async"
        className={cn('shrink-0 rounded-full bg-ink-100 object-cover', className)}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold text-white',
        'bg-gradient-to-br from-brand-600 to-(--color-brand-accent)',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
