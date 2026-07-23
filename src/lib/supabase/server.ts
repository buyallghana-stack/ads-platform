import { cookies } from 'next/headers'

import { createServerClient } from '@supabase/ssr'

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

  return createServerClient(
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
