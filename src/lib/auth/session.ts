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

/**
 * Whose screens are being rendered — the signed-in user, or the person a super
 * admin is viewing as.
 *
 * ⚠️ READS ONLY. Never use this to decide what a mutation may touch. That is
 * `getSessionUser()`, which always returns the real signed-in account, and the
 * separation is the safety property of the whole "view as user" feature: if a
 * write ever slipped past the middleware block, it would act on the ADMIN's own
 * account rather than on the account they are looking at.
 *
 * Returns a `User` shaped exactly like the real one so every page that already
 * takes `user.id` keeps working untouched.
 */
export const getViewerUser = cache(async (): Promise<User | null> => {
  const real = await getSessionUser()
  if (!real) return null

  const { getViewAsSession } = await import('@/lib/admin/view-as')
  const session = await getViewAsSession()
  if (!session || session.adminId !== real.id) return real

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { data, error } = await createAdminClient().auth.admin.getUserById(session.targetUserId)
  /* Fall back to the admin's own identity rather than rendering somebody
     else's screen with a half-resolved user — a failure here must not turn
     into a page that quietly shows the wrong person's balance. */
  if (error || !data.user) return real

  return data.user
})

export type Profile = {
  full_name: string | null
  referral_code: string | null
  phone: string | null
}

/** The profile fields every signed-in surface reuses. One cached query. */
export const getProfile = cache(async (userId: string): Promise<Profile | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('full_name, referral_code, phone')
    .eq('id', userId)
    .maybeSingle()
  return data
})
