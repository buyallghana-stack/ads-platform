/**
 * Decorative artwork for the brand panel.
 *
 * Inline SVG rather than a photograph, deliberately:
 *
 *   - Licensing. This is a commercial product that will handle real money.
 *     Stock imagery pulled off the web carries real exposure, and "we found it
 *     on Google" is not a licence. Everything here is drawn in this file.
 *   - Weight. Roughly 2 KB gzipped against 200 KB+ for a hero photograph.
 *     Users are on Ghanaian mobile data, and this is the first screen they
 *     ever load (§8).
 *   - Colour. It is drawn in currentColor and brand tokens, so it can never
 *     clash with the palette the way a stock photo would.
 *
 * Motif: concentric rings radiating from a play mark — attention going out,
 * value coming back. Purely decorative, so it is hidden from assistive
 * technology.
 */
export function PanelArtwork({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 480 480"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="pa-fade" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="70%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="pa-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.05" />
        </linearGradient>

        <pattern id="pa-dots" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.5" fill="#fff" fillOpacity="0.14" />
        </pattern>
      </defs>

      {/* Dot field, faded out at the edges so it reads as texture not tiling */}
      <rect width="480" height="480" fill="url(#pa-dots)" mask="url(#pa-mask)" />
      <mask id="pa-mask">
        <rect width="480" height="480" fill="url(#pa-fade)" />
      </mask>

      {/* Radiating rings */}
      <circle cx="240" cy="240" r="212" stroke="url(#pa-ring)" strokeWidth="1" />
      <circle cx="240" cy="240" r="168" stroke="url(#pa-ring)" strokeWidth="1.25" />
      <circle cx="240" cy="240" r="124" stroke="url(#pa-ring)" strokeWidth="1.5" />

      {/* Soft core */}
      <circle cx="240" cy="240" r="92" fill="url(#pa-fade)" />
      <circle cx="240" cy="240" r="72" fill="#fff" fillOpacity="0.12" />
      <circle cx="240" cy="240" r="72" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.5" />

      {/* Play mark */}
      <path d="M223 212v56l46-28z" fill="#fff" fillOpacity="0.92" />

      {/* Orbiting tokens — the reward side of the exchange */}
      <g fill="#fff">
        <circle cx="240" cy="72" r="9" fillOpacity="0.85" />
        <circle cx="393" cy="167" r="6.5" fillOpacity="0.55" />
        <circle cx="357" cy="357" r="11" fillOpacity="0.7" />
        <circle cx="112" cy="330" r="7.5" fillOpacity="0.5" />
        <circle cx="76" cy="176" r="5.5" fillOpacity="0.4" />
      </g>

      {/* Arc accents */}
      <path
        d="M240 28a212 212 0 0 1 184 106"
        stroke="#fff"
        strokeOpacity="0.5"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M56 346a212 212 0 0 0 128 100"
        stroke="#fff"
        strokeOpacity="0.3"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
