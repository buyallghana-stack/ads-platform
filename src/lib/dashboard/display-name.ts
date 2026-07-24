/**
 * Pick the greeting name and a font size that will fit (operator spec
 * 2026-07-24).
 *
 * Rule: show the FIRST name. If it is too long to sit well in "Welcome back,
 * X", fall back to the LAST name. If that is also long, use whichever has
 * fewer letters and step the font size down so it still fits — never overflow,
 * never truncate a person's name mid-word.
 *
 * Length-bucketed rather than pixel-measured so it works in a Server
 * Component with no client round trip; paired with break-words at the call
 * site, it cannot overflow on any screen.
 */
const FIT = 12 // a single name longer than this starts crowding the line on ~360px

export function pickDisplayName(fullName: string | null | undefined): {
  name: string | null
  sizeClass: string
} {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const first = parts[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1] : ''

  // Null name signals the caller to use its localized "there" fallback.
  if (!first) return { name: null, sizeClass: 'text-lg' }

  let name = first
  // First too long and last is shorter -> prefer the last name.
  if (first.length > FIT && last && last.length < first.length) name = last

  const len = name.length
  const sizeClass =
    len <= 10 ? 'text-lg' : len <= 15 ? 'text-base' : len <= 20 ? 'text-sm' : 'text-[0.8125rem]'

  return { name, sizeClass }
}
