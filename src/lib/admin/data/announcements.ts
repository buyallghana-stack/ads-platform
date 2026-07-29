import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * What the operator has told everybody, and how many people the next one
 * would reach.
 *
 * The user's client, as with the other admin reads: both functions re-check
 * `is_admin()` for a non-null caller, so this answers to the same predicate
 * that guards the tables themselves. Sending is the part that needs the
 * service client and the acting admin's id.
 */

export type Announcement = {
  id: string
  title: string
  body: string
  audience: string
  recipientCount: number
  sentByName: string
  createdAt: string
}

export async function getAnnouncements(limit = 50): Promise<Announcement[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_announcements', { p_limit: limit })
  if (error) throw new Error(`Could not load announcements: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    recipientCount: row.recipient_count,
    sentByName: row.sent_by_name,
    createdAt: row.created_at,
  }))
}

/**
 * How many people would receive one right now.
 *
 * Shown BEFORE sending, because this is the one screen in the admin area whose
 * action cannot be undone — a notification sent to everybody cannot be
 * recalled — and "this goes to 1,432 people" is the sentence that makes
 * somebody read their own message once more.
 */
export async function getAudienceSize(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_announcement_audience')
  return error ? 0 : (data ?? 0)
}
