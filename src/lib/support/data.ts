import { cache } from 'react'

import { getSessionUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

/**
 * The person's own support conversation.
 *
 * FILTERED BY user_id EXPLICITLY, like every other user-facing read in this
 * app. The policy on these tables happens to be own-rows-only with no admin
 * branch — deliberately, because this is the most personal text in the
 * product — but a query that says whose rows it wants is correct on its own
 * terms rather than one policy edit away from leaking. See the same note on
 * `lib/notifications/data.ts`, which is where that lesson was paid for.
 */

export type SupportAuthor = 'user' | 'admin'

export type SupportMessage = {
  id: string
  author: SupportAuthor
  body: string
  createdAt: string
  readAt: string | null
}

export type SupportThread = {
  status: 'open' | 'closed'
  messages: SupportMessage[]
  /** Replies the person has not opened yet — drives nothing today, but the
   *  bell already tells them, and the screen marks them read on arrival. */
  unreadFromSupport: number
}

export const getSupportThread = cache(async (): Promise<SupportThread> => {
  const user = await getSessionUser()
  if (!user) return { status: 'open', messages: [], unreadFromSupport: 0 }

  const supabase = await createClient()

  const [{ data: messages }, { data: thread }] = await Promise.all([
    supabase
      .from('support_messages')
      .select('id, author, body, created_at, read_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
    supabase.from('support_threads').select('status').eq('user_id', user.id).maybeSingle(),
  ])

  const rows = messages ?? []

  return {
    // No thread row yet simply means nobody has written. That is an open
    // conversation waiting to happen, not a closed one.
    status: thread?.status ?? 'open',
    messages: rows.map((m) => ({
      id: m.id,
      author: m.author,
      body: m.body,
      createdAt: m.created_at,
      readAt: m.read_at,
    })),
    unreadFromSupport: rows.filter((m) => m.author === 'admin' && m.read_at === null).length,
  }
})
