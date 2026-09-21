import { cn } from '@/lib/cn'

/**
 * The advertiser's mark on a card, a player and an article header.
 *
 * ONE COMPONENT, THREE SCREENS. It was three copies of the same gradient
 * square with `name.charAt(0)` in it, which is how the player and the card
 * end up disagreeing about what a brand looks like the first time one of them
 * is touched.
 *
 * THE INITIAL IS THE FALLBACK, NOT THE FAILURE STATE. Most ads will carry a
 * logo now, but an ad keyed in at midnight without one must still look
 * deliberate rather than broken, so the letter keeps the same gradient it has
 * always had and the two sit at the same size.
 *
 * WHY `loading="lazy"` MATTERS HERE MORE THAN IT LOOKS
 * The feed is up to sixty cards. Without it, opening the Ads tab fetches
 * sixty logos before the viewer has scrolled past the first three, on a
 * connection where that is the whole point. With it, a phone pays for what is
 * on the screen. The files are small by then anyway: the admin uploader
 * resizes to a 96 px square WebP in the browser before anything is sent.
 */
export function AdvertiserMark({
  name,
  logoUrl,
  className,
}: {
  name: string | null
  logoUrl?: string | null
  className?: string
}) {
  const box = cn('size-8 shrink-0 rounded-[0.625rem]', className)

  if (logoUrl) {
    return (
      // Supabase public URL. next/image would add an optimiser round trip and
      // a per-request transform bill for a picture that is already 96px and a
      // few kilobytes by the time it leaves the admin.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        decoding="async"
        /* `contain`, not `cover`: a logo cropped to fill its box is a logo
           with its wordmark cut off. White behind it, because most brand
           marks are drawn for a light background and a transparent PNG on a
           dark card is an invisible logo. */
        className={cn(box, 'bg-white object-contain p-0.5')}
      />
    )
  }

  const letter = (name ?? '·').trim().charAt(0).toUpperCase() || '·'

  return (
    <span
      aria-hidden
      className={cn(
        box,
        'grid place-items-center',
        /* Solid colour under the gradient: Safari before 16.4 has no
           @property, so a Tailwind gradient paints nothing and white letters
           would sit on whatever is behind. */
        'bg-brand-600 bg-gradient-to-br from-brand-600 to-(--color-brand-accent)',
        'text-[0.8125rem] font-bold text-white',
      )}
    >
      {letter}
    </span>
  )
}
