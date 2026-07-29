'use server'

import { z } from 'zod'

import { getPeople } from '@/lib/admin/data/people'
import { getSupportThreadFor, type AdminSupportThread } from '@/lib/admin/data/support'
import type { Person } from '@/lib/admin/types'
import { getSessionUser } from '@/lib/auth/session'
import { isAdminUser } from '@/lib/auth/landing'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Reading and answering support conversations.
 *
 * The acting admin comes from the verified session and NEVER from the
 * payload, exactly as in the users and payouts actions — a server action is a
 * public HTTP endpoint, and the id the browser sends is a claim. The database
 * checks it again through `assert_admin`, which is also what puts a name in
 * the audit trail.
 *
 * THE SESSION IS CHECKED HERE TOO, not only in the database. These three
 * functions are revoked from `authenticated`, so the service client is the
 * only caller that can reach them — which means this file is the door, and a
 * door with no lock on our side would hand every transcript to anyone who can
 * post to it.
 */

const UNAUTHORISED = 'You are not signed in as an administrator.'
const GENERIC = 'That could not be saved. Please try again.'

async function actingAdmin(): Promise<string | null> {
  const user = await getSessionUser()
  if (!user) return null
  return (await isAdminUser(user.id)) ? user.id : null
}

export type ThreadResult =
  | { ok: true; thread: AdminSupportThread; people?: Person[] }
  | { ok: false; message: string }

/** The transcript, loaded when the operator opens somebody's conversation. */
export async function loadSupportThread(userId: string): Promise<ThreadResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: UNAUTHORISED }

  const parsed = z.uuid().safeParse(userId)
  if (!parsed.success) return { ok: false, message: GENERIC }

  try {
    const admin = createAdminClient()
    // Opening it is reading it. The unread count on the card is the operator's
    // own to-do list, and it should empty when they actually look.
    await admin.rpc('admin_mark_support_read', { p_admin: adminId, p_user: parsed.data })

    const [thread, people] = await Promise.all([
      getSupportThreadFor(adminId, parsed.data),
      getPeople('messages'),
    ])
    return { ok: true, thread, people }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : GENERIC }
  }
}

const replySchema = z.object({
  userId: z.uuid(),
  body: z.string().trim().min(1).max(2000),
})

/**
 * Sends a reply and hands back BOTH the conversation and the refreshed list —
 * the same rule as the payout queue: the screen renders what the database
 * did, never what the UI predicted. The list matters because replying changes
 * the card's unread count and its position in the inbox.
 */
export async function replyToSupport(input: {
  userId: string
  body: string
}): Promise<ThreadResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: UNAUTHORISED }

  const parsed = replySchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Write a reply first.' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_send_support_message', {
    p_admin: adminId,
    p_user: parsed.data.userId,
    p_body: parsed.data.body,
  })

  // Postgres phrases these for an operator, so they are surfaced as written.
  if (error) return { ok: false, message: error.message || GENERIC }

  try {
    const [thread, people] = await Promise.all([
      getSupportThreadFor(adminId, parsed.data.userId),
      getPeople('messages'),
    ])
    return { ok: true, thread, people }
  } catch {
    return { ok: false, message: GENERIC }
  }
}

/** Files a conversation as done, or puts it back. */
export async function setSupportStatus(userId: string, closed: boolean): Promise<ThreadResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: UNAUTHORISED }

  const parsed = z.uuid().safeParse(userId)
  if (!parsed.success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_set_support_status', {
    p_admin: adminId,
    p_user: parsed.data,
    p_closed: closed,
  })

  if (error) return { ok: false, message: error.message || GENERIC }

  try {
    const [thread, people] = await Promise.all([
      getSupportThreadFor(adminId, parsed.data),
      getPeople('messages'),
    ])
    return { ok: true, thread, people }
  } catch {
    return { ok: false, message: GENERIC }
  }
}
