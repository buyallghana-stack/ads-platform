import 'server-only'

import { cache } from 'react'

import type { User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'

/**
 * Request-deduplicated session + profile reads.
 *
 * `getUser()` makes a network round trip to the Supabase auth server to VERIFY
 * the token (not just read the cookie — the difference decides whether someone
 * can move money). The (app) layout and the page inside it both need the user,
 * and both need the profile; without dedup that is two auth verifications and
 * two profile queries per dashboard load, each paying Ghana->server latency.
 *
 * React's cache() collapses identical calls within a single request render, so
 * the layout and page share one verification and one profile fetch. It does
 * NOT persist across requests — a fresh request re-verifies, which is correct.
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

export type Profile = {
  full_name: string | null
  referral_code: string | null
}

/** The profile fields every signed-in surface reuses. One cached query. */
export const getProfile = cache(async (userId: string): Promise<Profile | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('full_name, referral_code')
    .eq('id', userId)
    .maybeSingle()
  return data
})
