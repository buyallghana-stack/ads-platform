import { cookies, headers } from 'next/headers'

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
    Sign-in happens in a Server Action, so without this Supabase Auth sees OUR
    request and records the Node runtime as the device — every entry in the
    user's Active sessions list then reads "Unknown device", which is worse
    than useless on a screen whose whole job is "do you recognise this?".
    Forwarding the browser's own identifiers makes the session record describe
    the actual device.
  */
  const requestHeaders = await headers()
  const userAgent = requestHeaders.get('user-agent')
  const forwardedFor =
    requestHeaders.get('x-real-ip')?.trim() || requestHeaders.get('x-forwarded-for')?.trim()

  const globalHeaders: Record<string, string> = {}
  if (userAgent) globalHeaders['User-Agent'] = userAgent
  if (forwardedFor) globalHeaders['X-Forwarded-For'] = forwardedFor

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { headers: globalHeaders },
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
