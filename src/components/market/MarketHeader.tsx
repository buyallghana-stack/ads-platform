import { ModeSwitch } from '@/components/app/ModeSwitch'

/**
 * The Market dashboard's own header.
 *
 * The app shell deliberately carries no global header (operator direction,
 * 2026-07-24: that chrome is Home-only), and the bottom tab bar is full at its
 * documented five-destination ceiling. So on a phone there is nowhere for the
 * mode switch to live except here — each mode's dashboard carries the switch
 * out of the other one.
 *
 * That costs a mobile user one extra tap to cross from, say, the Ads screen to
 * the Shop: back to the dashboard, then switch. Acceptable, because crossing
 * between two businesses is a deliberate act rather than an idle one, and the
 * alternative was demoting an ads destination to make room.
 *
 * `md:hidden` on the switch: from the tablet breakpoint up it is pinned in the
 * sidebar, where it is always visible, and two of them on one screen would be
 * two answers to "which business am I in".
 */
export function MarketHeader({
  title,
  description,
  bare = false,
}: {
  title: string
  description?: string
  /**
   * A signed-out visitor on the shop — the normal case for an affiliate link.
   *
   * The mode switch is hidden for them because both of its destinations
   * require an account. Offering a control that only leads to a login page is
   * worse than not offering it: it looks like navigation and behaves like a
   * wall.
   */
  bare?: boolean
}) {
  return (
    /* The bar spans the full width so its bottom border reads as a real edge
       to the page, but the TEXT is capped at the same max-w-6xl the ads
       dashboard uses. Without that cap a headline runs to 1400px on a desktop
       and stops looking like a heading. */
    <header className="border-b border-ink-200 bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 md:px-8 md:py-5">
        {!bare && <ModeSwitch className="mb-4 md:hidden" />}
        <h1 className="text-[1.375rem] leading-tight font-semibold tracking-[-0.02em] text-ink-900 md:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-prose text-[0.875rem] leading-snug text-ink-600">
            {description}
          </p>
        )}
      </div>
    </header>
  )
}
