import { type NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@supabase/ssr'

import { clientEnv } from '@/lib/env'

/**
 * Refreshes the Supabase session on every request.
 *
 * Access tokens are short-lived. Without a refresh here, a user whose token
 * expires mid-session gets silently signed out by the next Server Component
 * that asks who they are — which on this platform means losing their place in
 * an ad they were part-way through watching.
 *
 * Two rules that are easy to get wrong and painful to debug:
 *
 *   1. Cookies must be written to BOTH the request and the response. The
 *      request copy is what Server Components downstream read in this same
 *      pass; the response copy is what the browser stores for the next one.
 *      Setting only the response leaves this request seeing a stale session.
 *   2. `getUser()` and not `getSession()`. getSession reads the cookie and
 *      trusts it; getUser verifies the token with the auth server. On a
 *      platform where the difference decides whether someone can move money,
 *      the extra round trip is the correct trade.
 */
export async function updateSession(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do not remove. This call is what performs the refresh; discarding the
  // result is fine, the cookie write is the point.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
}
