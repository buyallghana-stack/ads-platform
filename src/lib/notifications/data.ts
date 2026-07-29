import { cache } from 'react'

import { getSessionUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

/**
 * Notifications read layer.
 *
 * EVERY READ IS FILTERED BY user_id EXPLICITLY. It used to rely on RLS alone,
 * on the stated assumption that the policy scoped a read to the caller's own
 * rows. It does not: the policy is `auth.uid() = user_id OR is_admin()`, so an
 * ADMIN reading their own dashboard got every user's notifications merged into
 * their bell and their list. The operator found it on the two demo accounts —
 * one signed in as the admin saw the other's payout notices.
 *
 * The writes were never affected (mark-read and clear are SECURITY DEFINER and
 * scope to `auth.uid()` in SQL), which is why the symptom was a list that
 * showed somebody else's rows but could not act on them.
 *
 * The policy is tightened in migration 057 as well, but the filter here is
 * what makes this module correct on its own terms: a user-facing query should
 * say which user it is for rather than inherit it from a policy written for a
 * different audience. Anything relying on "RLS will handle it" is one policy
 * edit away from leaking, and admins are the one class of caller for whom
 * "own rows" is quietly false everywhere in this schema.
 */

export type NotificationType = 'announcement' | 'payout' | 'flag' | 'support'

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
  const user = await getSessionUser()
  if (!user) return []

  const supabase = await createClient()
  let query = supabase
    .from('notifications')
    .select(COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (limit) query = query.limit(limit)

  const { data } = await query
  return (data ?? []) as NotificationRow[]
})

/** Unread count for the bell badge. head+count, so no rows travel. */
export const getUnreadCount = cache(async (): Promise<number> => {
  const user = await getSessionUser()
  if (!user) return 0

  const supabase = await createClient()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)
  return count ?? 0
})
