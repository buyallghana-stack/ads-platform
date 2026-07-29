'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Sending to support, and marking replies read.
 *
 * Both go through SECURITY DEFINER functions that take their identity from
 * the JWT rather than from an argument, so the user client is the right
 * caller and there is nothing here to spoof — a server action is a public
 * HTTP endpoint, and one that accepted a user id would let anyone write as
 * anyone. The same reasoning as the withdrawal PIN action.
 */

export type SendResult = { ok: true } | { ok: false; message: string }

export async function sendSupportMessage(body: string, about?: string): Promise<SendResult> {
  const text = body.trim()
  if (!text) return { ok: false, message: 'Write a message first' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('send_support_message', {
    p_body: text,
    // What they were looking at when they opened the conversation. Support's
    // first question is always "which one?" — this answers it in advance.
    p_context: about ? { from: about } : undefined,
  })

  if (error) {
    /*
      The database phrases these for a person on purpose — the rate limit and
      the length limit both explain what to do next — so they are surfaced as
      written rather than replaced with a generic apology. Anything without a
      message (a dropped connection) still gets one.
    */
    return { ok: false, message: error.message || 'That did not send. Please try again.' }
  }

  return { ok: true }
}

export async function markSupportRead(): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('mark_support_read')
}
