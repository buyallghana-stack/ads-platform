import { cn } from '@/lib/cn'

/**
 * SidePerks wordmark, using the operator's supplied logo (2026-07-24).
 *
 * The mark is a full-colour raster, so it rides inside a small white tile —
 * an app-icon treatment that keeps it legible on a light surface, on the dark
 * app shell, and on the blue auth panel alike, without needing a separate
 * transparent asset per background. The wordmark is two-tone on light (Side in
 * ink, Perks in brand) and solid white on the blue panel.
 */
export function Logo({
  className,
  variant = 'light',
  showWordmark = true,
  wordmarkClassName,
}: {
  className?: string
  /** 'light' for use on the blue panel, 'dark' for use on a light surface. */
  variant?: 'light' | 'dark'
  showWordmark?: boolean
  /**
   * Classes on the wordmark itself, so a caller can drop it at one breakpoint
   * and keep it at another. `showWordmark` is a boolean and cannot do that, and
   * rendering the whole logo twice would put two `role="img"` copies of the
   * same brand in the accessibility tree.
   */
  wordmarkClassName?: string
}) {
  const isLight = variant === 'light'

  return (
    <span
      className={cn('inline-flex items-center gap-2.5', className)}
      role="img"
      aria-label="SidePerks"
    >
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-[0.5rem] bg-white shadow-[0_1px_2px_rgb(15_23_42/0.12)] ring-1 ring-ink-900/5">
        {/* Plain img (not next/image): a tiny static mark, and it avoids the
            optimizer config for the sake of one asset. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sideperks-mark.png"
          alt=""
          width={32}
          height={32}
          className="size-full object-contain"
        />
      </span>

      {showWordmark &&
        (isLight ? (
          <span
            className={cn(
              'text-[1.0625rem] font-semibold tracking-[-0.02em] text-white',
              wordmarkClassName,
            )}
          >
            SidePerks
          </span>
        ) : (
          <span
            className={cn('text-[1.0625rem] font-semibold tracking-[-0.02em]', wordmarkClassName)}
          >
            <span className="text-ink-900">Side</span>
            <span className="text-brand-600">Perks</span>
          </span>
        ))}
    </span>
  )
}
