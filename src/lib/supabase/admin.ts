import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/database.types'

import { clientEnv, requireSecretKey } from '@/lib/env'

/**
 * Privileged Supabase client. **Bypasses Row Level Security entirely.**
 *
 * The `server-only` import above is load-bearing: importing this module from a
 * client component is a build error, not a runtime surprise. That is the whole
 * defence against shipping the secret key to a browser.
 *
 * Legitimate uses are narrow:
 *   - admin dashboard reads that deliberately span all users
 *   - the redemption approval path, where an admin acts on another user's row
 *   - scheduled jobs with no signed-in user (daily cap resets, subscription
 *     expiry sweeps)
 *
 * It is NOT a convenience escape hatch for "RLS is getting in my way". If a
 * user-initiated action needs this client, the RLS policy is probably wrong —
 * fix the policy. Every call site should be able to answer: what stops a user
 * from reaching another user's points ledger or payout details here?
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, requireSecretKey(), {
    auth: {
      // No session persistence or token refresh: this client is stateless and
      // request-scoped. Persisting would risk bleeding privileged auth state
      // across requests.
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
