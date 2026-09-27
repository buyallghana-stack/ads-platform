'use server'

import { getSessionUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { personalSchema, type PersonalInput } from '@/lib/validation/personal'

/**
 * Personal-info writes: the NAME only. The column-level grant (migration 030)
 * enforces what a member may change even if this code were wrong.
 *
 * ⚠️ It used to write `phone` too, and the form never sent one, so every save
 * of a name set the phone to null. Since 2026-09-27 the phone is the sign-in
 * and moves only through /profile/phone after an SMS code; migration
 * 20260902000000 took the column's grant away from members as well.
 */
export type PersonalResult = { ok: true } | { ok: false; errorKey?: string; message?: string }

export async function updatePersonalInfo(input: PersonalInput): Promise<PersonalResult> {
  const parsed = personalSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errorKey: parsed.error.issues[0].message }

  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.fullName.trim(),
    })
    .eq('id', user.id)

  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
