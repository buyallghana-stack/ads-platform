/**
 * The coin stack on the congratulation screen.
 *
 * ⚠️ DRAWN RATHER THAN PLACED, FOR ONE REASON: THE CURRENCY. The operator's
 * reference art is a stack of dollar coins, and this screen's whole job is to
 * prove that a Ghanaian member just earned real cedis. A dollar sign sitting
 * directly above a figure reading "GHS 1.00" undoes the sentence the screen is
 * making. The face here carries a cedi mark.
 *
 * It is also sharp at every size, which a raster never is once it is scaled up
 * for a hero, and it takes its colours from props so the same drawing works on
 * the green field and on a light card.
 *
 * The geometry follows the reference: a stack seen slightly from above, coins
 * as 2:1 ellipses, and one coin stood on its edge in front of it. Each coin is
 * a body plus a top face, so the stack reads as solid rather than as a pile of
 * rings.
 */
export function Coins({
  className,
  title,
}: {
  className?: string
  /** Null when the drawing sits beside text that already says it. */
  title?: string | null
}) {
  const face = '#FFD44F'
  const body = '#FFC01A'
  const edge = '#F2A81E'
  const mark = '#EF8A1E'
  const sheen = '#FFE283'

  /** One coin of the stack: the rim, then the face on top of it. */
  const coin = (cy: number, key: number) => (
    <g key={key}>
      <path d={`M88,${cy} a62,31 0 0 0 124,0 v16 a62,31 0 0 1 -124,0 z`} fill={edge} />
      <ellipse cx={150} cy={cy} rx={62} ry={31} fill={body} />
      <ellipse cx={150} cy={cy} rx={62} ry={31} fill={face} opacity={0.55} />
    </g>
  )

  return (
    <svg
      viewBox="0 0 260 210"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      {/* The ground shadow, first, so everything sits on it. */}
      <ellipse cx={140} cy={186} rx={96} ry={16} fill="#000000" opacity={0.16} />

      {/* The stack, drawn bottom coin first so each one overlaps the last. */}
      {[150, 126, 102, 78, 54].map((cy, i) => coin(cy, i))}

      {/* The coin standing on its edge, in front. It sits on the shared ground
          shadow above; a second ellipse of its own showed as a pale blister
          poking out from behind the stack. */}
      <circle cx={84} cy={124} r={60} fill={edge} />
      <circle cx={80} cy={122} r={60} fill={body} />
      <circle cx={80} cy={122} r={50} fill={face} />
      <circle cx={80} cy={122} r={50} fill="none" stroke={sheen} strokeWidth={3} />

      {/*
        ⚠️ THE CEDI MARK IS A C WITH A VERTICAL STROKE (₵), NOT A HORIZONTAL
        ONE. Drawn with the bar across it, which is the obvious first guess, it
        reads as a euro sign, and a euro on this screen is no better than the
        dollar it replaced.

        Paths rather than <text>: a webfont is not guaranteed to have painted
        when this renders, and a missing glyph would be a box in the middle of
        the happiest screen in the product.
      */}
      <path
        d="M98,100 a28,28 0 1 0 0,44"
        fill="none"
        stroke={mark}
        strokeWidth={11}
        strokeLinecap="round"
      />
      <path d="M80,88 v68" stroke={mark} strokeWidth={11} strokeLinecap="round" />
    </svg>
  )
}
