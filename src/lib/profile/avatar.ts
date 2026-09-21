/**
 * The mark that stands for a person.
 *
 * Profile photos were withdrawn on 2026-09-21 (operator decision, migration
 * 239): nobody uploads one and nothing renders one, so everybody is drawn as
 * their initials on the gradient circle that used to be the fallback. What
 * was `avatarPublicUrl` is gone with it rather than left as a function with
 * no callers, which is how dead paths come back.
 */

/** Two-letter initials from a full name. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
