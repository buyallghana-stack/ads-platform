import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Must this account prove a phone before it goes any further?
 *
 * True for every account without a verified phone, which on 2026-09-27 was all
 * of them: the operator's direction was that existing members re-verify, not
 * only new ones. Checked in the (app) layout, the one place every signed-in
 * screen passes through, so a direct URL cannot step around it.
 *
 * `phone_verification_required` is the emergency switch (if the SMS gateway is
 * down, nobody new could get in). A failed read FAILS CLOSED: the gate stays
 * up, because an unverified account inside is exactly what the rule forbids.
 */
export async function needsPhoneVerification(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const [{ data: profile }, { data: config }] = await Promise.all([
    admin.from('profiles').select('phone_verified_at').eq('id', userId).maybeSingle(),
    admin.from('app_config').select('value').eq('key', 'phone_verification_required').maybeSingle(),
  ])
  if (profile?.phone_verified_at) return false
  return config?.value !== 'false'
}
