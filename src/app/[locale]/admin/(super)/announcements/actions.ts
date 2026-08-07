'use server'

import { z } from 'zod'

import { getAnnouncements, type Announcement } from '@/lib/admin/data/announcements'
import { getSessionUser } from '@/lib/auth/session'
import { isAdminUser } from '@/lib/auth/landing'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Sending an announcement.
 *
 * The acting admin comes from the verified session, never the payload, and the
 * database asserts it again — which is also what puts their name on the row
 * and into the audit trail. The service client is the only caller that can
 * reach the function at all.
 *
 * THIS IS THE ONE ADMIN ACTION THAT CANNOT BE UNDONE. A notification sent to
 * every account cannot be recalled, edited or deleted from their bells. The
 * screen confirms before calling this; the server does not second-guess that,
 * but it is the reason the refreshed list comes back — so what happened is
 * shown from the database rather than assumed.
 */

const UNAUTHORISED = 'You are not signed in as an administrator.'

const schema = z.object({
  title: z.string().trim().min(1, 'Give the announcement a title.').max(120),
  body: z.string().trim().min(1, 'Write the message.').max(1000),
})

export type SendAnnouncementResult =
  | { ok: true; recipients: number; announcements: Announcement[] }
  | { ok: false; message: string }

export async function sendAnnouncement(input: {
  title: string
  body: string
  /** Who it reaches AND which bell it lands in. 'all' shows in both. */
  audience?: 'all' | 'affiliates' | 'ads'
}): Promise<SendAnnouncementResult> {
  const user = await getSessionUser()
  if (!user || !(await isAdminUser(user.id))) return { ok: false, message: UNAUTHORISED }

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_broadcast_announcement', {
    p_admin: user.id,
    p_title: parsed.data.title,
    p_body: parsed.data.body,
    p_audience: input.audience ?? 'all',
  })

  // Postgres phrases the refusals for an operator; they are shown as written.
  if (error) return { ok: false, message: error.message || 'That could not be sent.' }

  return {
    ok: true,
    // PostgREST returns a composite-returning function as a single object,
    // never an array — the lesson from request_redemption.
    recipients: (data as unknown as { recipient_count: number } | null)?.recipient_count ?? 0,
    announcements: await getAnnouncements(),
  }
}
