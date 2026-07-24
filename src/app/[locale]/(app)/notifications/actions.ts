'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Notification mutations. Each is a thin wrapper over a SECURITY DEFINER
 * function that self-scopes to auth.uid(), so the user client is the right
 * caller — a user can only ever touch their own rows, and "Clear all" leaves
 * flag notifications in place (enforced in the database, not here).
 *
 * These return void; the calling client component refreshes the route so the
 * server re-reads the badge count and the lists.
 */

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('mark_all_notifications_read')
}

export async function markNotificationRead(id: string): Promise<void> {
  if (!id) return
  const supabase = await createClient()
  await supabase.rpc('mark_notification_read', { p_id: id })
}

export async function clearNotifications(): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('clear_notifications')
}
