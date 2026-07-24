import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Notifications read layer. Uses the signed-in user's client, so RLS scopes
 * every read to the caller's own rows — no explicit user_id filter needed.
 *
 * Wrapped in React cache() so the Home header (badge + panel) and the full
 * page resolve from one query per request rather than repeating it.
 */

export type NotificationType = 'announcement' | 'payout' | 'flag'

export type NotificationRow = {
  id: string
  type: NotificationType
  title: string
  body: string
  read_at: string | null
  created_at: string
}

const COLUMNS = 'id, type, title, body, read_at, created_at'

/** Newest first. `limit` caps the panel; the full page passes none. */
export const getNotifications = cache(async (limit?: number): Promise<NotificationRow[]> => {
  const supabase = await createClient()
  let query = supabase
    .from('notifications')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
  if (limit) query = query.limit(limit)

  const { data } = await query
  return (data ?? []) as NotificationRow[]
})

/** Unread count for the bell badge. head+count, so no rows travel. */
export const getUnreadCount = cache(async (): Promise<number> => {
  const supabase = await createClient()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  return count ?? 0
})
