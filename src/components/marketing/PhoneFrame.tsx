import { cn } from '@/lib/cn'

/**
 * A phone shell around a real screenshot of the app.
 *
 * The imagery on this page is the product itself — genuine signed-in screens
 * captured by `scripts/shoot-marketing.mjs` — rather than stock photography or
 * a drawing of an interface. That is the honest option (nothing on the page
 * shows a feature that does not exist) and it is also what every product this
 * audience already uses does on its own front page.
 *
 * TWO IMAGES PER SCREEN, one per theme, swapped with `dark:` visibility. A
 * light screenshot dropped onto the dark page reads as a foreign object glued
 * on — the one detail that gives away a mocked-up landing page. Both files are
 * WebP and under 50 KB, so carrying the pair costs less than one careless PNG.
 *
 * `srcLight`/`srcDark` are paths under /public. Width and height are the real
 * pixel dimensions of the capture, passed so the browser reserves the box and
 * the hero does not reflow as it loads.
 */
export function PhoneFrame({
  srcLight,
  srcDark,
  alt,
  width,
  height,
  priority = false,
  className,
}: {
  srcLight: string
  srcDark: string
  alt: string
  width: number
  height: number
  priority?: boolean
  className?: string
}) {
  // Plain <img>, matching Logo.tsx: these are pre-sized, already-compressed
  // static assets, so the optimizer has nothing left to do for them.
  const imgClass = 'block h-auto w-full'
  const common = {
    width,
    height,
    className: imgClass,
    decoding: 'async' as const,
    // The hero phone is the largest thing above the fold; everything below it
    // can wait until it is scrolled to.
    loading: priority ? ('eager' as const) : ('lazy' as const),
    fetchPriority: priority ? ('high' as const) : ('auto' as const),
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[1.75rem] border border-ink-900/10 bg-ink-900 p-2',
        'shadow-[0_1px_2px_rgb(15_23_42/0.06),0_18px_40px_-12px_rgb(15_23_42/0.28)]',
        'dark:border-white/10',
        className,
      )}
    >
      {/* Screen. The inner radius is the outer minus the bezel, or the corners
          visibly disagree. */}
      <div className="relative overflow-hidden rounded-[1.375rem] bg-canvas">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img {...common} src={srcLight} alt={alt} className={cn(imgClass, 'dark:hidden')} />
        {/* The dark twin is decorative — the light one already carries the
            accessible name, and announcing the same screen twice is noise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img {...common} src={srcDark} alt="" className={cn(imgClass, 'hidden dark:block')} />

        {/* Fades the screenshot out at the bottom instead of cutting it off
            mid-card, so the frame reads as a phone showing more below rather
            than a cropped picture. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-canvas to-transparent"
        />
      </div>
    </div>
  )
}
