import { clientEnv } from '@/lib/env'

/** Two-letter initials from a full name, for the avatar fallback. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Public URL for an avatar stored in the `avatars` bucket. Null when unset. */
export function avatarPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${path}`
}
