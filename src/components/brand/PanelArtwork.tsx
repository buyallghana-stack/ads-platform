/**
 * Decorative texture for the brand panel.
 *
 * Deliberately quiet. The previous version put hard concentric rings and a
 * large play triangle behind the headline, which competed with the type
 * instead of supporting it — the panel read as busy rather than considered.
 * This is a fine grid with two soft blooms: visible enough that the panel is
 * not flat, faint enough that you notice the words first.
 *
 * Inline SVG rather than a photograph, on purpose:
 *   - Licensing. This product will handle real money; "found on Google" is
 *     not a licence, and reverse image search makes it trivially checkable.
 *   - Weight. Around 1 KB gzipped against 200 KB+ for a hero image, on the
 *     first screen a user ever loads over Ghanaian mobile data (§8).
 *   - Colour. Drawn in brand tokens, so it cannot drift out of palette.
 */
export function PanelArtwork({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 600"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="pa-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0v40" stroke="#fff" strokeOpacity="0.06" strokeWidth="1" fill="none" />
        </pattern>

        <radialGradient id="pa-bloom-a" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="pa-bloom-b" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7cc4ff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#7cc4ff" stopOpacity="0" />
        </radialGradient>

        {/* Fade the grid out toward the bottom so it never fights the copy. */}
        <linearGradient id="pa-grid-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="pa-grid-mask">
          <rect width="600" height="600" fill="url(#pa-grid-fade)" />
        </mask>
      </defs>

      <rect width="600" height="600" fill="url(#pa-grid)" mask="url(#pa-grid-mask)" />

      <circle cx="520" cy="70" r="240" fill="url(#pa-bloom-b)" />
      <circle cx="90" cy="470" r="200" fill="url(#pa-bloom-a)" />
    </svg>
  )
}
