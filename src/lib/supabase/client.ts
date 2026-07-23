import { createBrowserClient } from '@supabase/ssr'

import { clientEnv } from '@/lib/env'

/**
 * Supabase client for browser/client components.
 *
 * Uses the publishable key, which is safe to ship to the browser *only*
 * because Row Level Security constrains what it can reach. Every table this
 * client touches must have RLS enabled with explicit policies (§2.4) — an
 * un-policied table is readable by anyone who opens devtools.
 *
 * Never use this for cap enforcement, points writes, or anything money-shaped.
 * The client is not a trust boundary; the database and server are.
 */
export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
}
