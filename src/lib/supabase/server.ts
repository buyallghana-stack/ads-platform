import { cookies } from 'next/headers'

import { createServerClient } from '@supabase/ssr'

import type { Database } from '@/lib/supabase/database.types'

import { clientEnv } from '@/lib/env'

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Acts as the signed-in user — RLS still applies, which is the point: server
 * code gets the user's own permissions, not elevated ones. Reach for
 * `createAdminClient()` only where a genuine privilege escalation is required,
 * and justify it there.
 *
 * Must be created per-request. Never hoist this into a module-level singleton:
 * one user's session would leak into another's request.
 */
export async function createClient() {
  const cookieStore = await cookies()

  /*
    NOTE: forwarding the browser's User-Agent and X-Forwarded-For from here was
    tried and does NOT work — Supabase's gateway overrides both, so GoTrue
    stored "node" and our Vercel egress IP for a phone in Ghana. Session device
    and IP are captured by `recordSessionContext` at sign-in instead. Do not
    reintroduce header forwarding expecting auth.sessions to improve.
  */
  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Server Components cannot set cookies. This is expected and safe
            // to ignore when middleware is refreshing the session, which it is
            // (see src/middleware.ts). Swallowing it anywhere else would hide a
            // real bug, so the middleware must stay in place.
          }
        },
      },
    },
  )
}
