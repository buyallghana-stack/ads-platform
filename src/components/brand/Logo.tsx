import { cn } from '@/lib/cn'

/**
 * SidePerks wordmark.
 *
 * The mark is a four-point sparkle in a rounded tile — "perks", the little
 * extra you earn on the side — replacing the earlier play-button glyph from
 * when the product was called AdReward. The wordmark is two-tone on light
 * surfaces (Side in ink, Perks in brand) and solid white on the blue panel.
 *
 * Placeholder-quality but intentional; a real brand asset drops in as a
 * single-file change here.
 */
export function Logo({
  className,
  variant = 'light',
  showWordmark = true,
}: {
  className?: string
  /** 'light' for use on the blue panel, 'dark' for use on a light surface. */
  variant?: 'light' | 'dark'
  showWordmark?: boolean
}) {
  const isLight = variant === 'light'

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 32 32"
        className="size-8 shrink-0"
        role="img"
        aria-label="SidePerks"
      >
        {/* Rounded tile. Brand fill on light surfaces; a soft translucent
            white on the blue panel so the mark reads either way. */}
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="9"
          className={isLight ? 'fill-white/15' : 'fill-brand-600'}
          stroke={isLight ? 'currentColor' : 'none'}
          strokeOpacity={isLight ? 0.5 : 0}
        />
        {/* Four-point sparkle, concave sides pulled toward the centre. */}
        <path
          d="M16 5.2C16.7 11.6 20.4 15.3 26.8 16 20.4 16.7 16.7 20.4 16 26.8 15.3 20.4 11.6 16.7 5.2 16 11.6 15.3 15.3 11.6 16 5.2Z"
          className="fill-white"
        />
      </svg>

      {showWordmark &&
        (isLight ? (
          <span className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-white">
            SidePerks
          </span>
        ) : (
          <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">
            <span className="text-ink-900">Side</span>
            <span className="text-brand-600">Perks</span>
          </span>
        ))}
    </span>
  )
}
