import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * One person's whole support conversation, for the panel.
 *
 * THE SERVICE CLIENT, not the user's own. `admin_get_support_thread` is
 * revoked from `authenticated` outright — unlike `admin_list_people`, which
 * re-checks `is_admin()` and can safely answer a browser token. A transcript
 * is the most personal text in the product, so the function that returns
 * somebody else's is reachable only from the server, and it asserts the
 * acting admin from an id the browser never supplies.
 */

export type AdminSupportMessage = {
  id: string
  author: 'user' | 'admin'
  /** Which administrator wrote it; null on the person's own messages. */
  authorName: string | null
  body: string
  createdAt: string
  readAt: string | null
}

export type AdminSupportThread = {
  status: 'open' | 'closed'
  messages: AdminSupportMessage[]
}

type ThreadPayload = {
  status: string
  messages: {
    id: string
    author: 'user' | 'admin'
    author_name: string | null
    body: string
    created_at: string
    read_at: string | null
  }[]
}

export async function getSupportThreadFor(
  adminId: string,
  userId: string,
): Promise<AdminSupportThread> {
  const admin = createAdminClient()

  const { data, error } = await admin.rpc('admin_get_support_thread', {
    p_admin: adminId,
    p_user: userId,
  })

  if (error) throw new Error(`Could not load the conversation: ${error.message}`)

  const payload = (data ?? { status: 'open', messages: [] }) as unknown as ThreadPayload

  return {
    status: payload.status === 'closed' ? 'closed' : 'open',
    messages: (payload.messages ?? []).map((m) => ({
      id: m.id,
      author: m.author,
      authorName: m.author_name,
      body: m.body,
      createdAt: m.created_at,
      readAt: m.read_at,
    })),
  }
}
