import { initials } from '@/lib/profile/avatar'
import { cn } from '@/lib/cn'

/**
 * A person's mark: the gradient circle with their initials.
 *
 * ⚠️ THERE IS NO PICTURE, AND NO `src` PROP. Profile photos were withdrawn on
 * 2026-09-21. The prop is not kept as an ignored no-op on purpose: a
 * component that accepts a `src` and silently drops it is a component
 * somebody will pass a URL to next month and then spend an afternoon asking
 * why nothing appears.
 *
 * What this replaces was also the platform's heaviest list: every row of the
 * leaderboard, the team screen and three admin tables fetched one image each,
 * from a bucket whose ceiling was 512 KB a file. Initials cost nothing.
 *
 * The caller sizes it (size-* on className) and sets the text size in the
 * same className, so the letters scale with the ring.
 */
export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold text-white',
        /* Solid colour under the gradient: Safari before 16.4 has no
           @property, so a Tailwind gradient paints nothing and white initials
           would sit on whatever is behind. See the dashboard hero for the
           whole story. */
        'bg-brand-600 bg-gradient-to-br from-brand-600 to-(--color-brand-accent)',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
