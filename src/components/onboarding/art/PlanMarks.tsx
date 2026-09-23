/**
 * One mark per plan, for the badge on its card.
 *
 * Drawn rather than taken from the icon set the rest of the app uses, because
 * these sit at 28px inside a coloured disc and have to read as a family: one
 * weight, one silhouette density, no strokes. A lucide outline icon beside a
 * filled one looks like two different products.
 *
 * They are decorative. Every card already names its plan in text, so these
 * carry `aria-hidden` and say nothing to a screen reader.
 */

const wrap = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-full">
    {children}
  </svg>
)

/** Bronze: a bolt. The first lift on a daily limit. */
export function BronzeMark() {
  return wrap(<path d="M13.5 2 4 13.2h6.1L9.8 22 20 10.6h-6.4z" />)
}

/** Silver: a star, the ordinary step up. */
export function SilverMark() {
  return wrap(<path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" />)
}

/** Pearl: a gem, cut. */
export function PearlMark() {
  return wrap(<path d="M7.2 3h9.6l4.2 5.4L12 21.4 3 8.4zm.9 2L5.6 8.2h4.1L11 5zm4.9 0 1.3 3.2h4.1L15.9 5zm.7 5.2h-3.4L12 17.6z" />)
}

/** Gold: a crown, the top of what is on sale. */
export function GoldMark() {
  return wrap(<path d="M3 8.4 6.6 12l3.6-6 1.8 3 1.8-3 3.6 6L21 8.4 19.2 19H4.8zM4.8 20.4h14.4V22H4.8z" />)
}

/** A plan without a mark of its own falls back to the star. */
export const PLAN_MARKS: Record<string, () => React.JSX.Element> = {
  bronze: BronzeMark,
  silver: SilverMark,
  pearl: PearlMark,
  gold: GoldMark,
}
