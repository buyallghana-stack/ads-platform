'use server'

import { getSessionUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { personalSchema, type PersonalInput } from '@/lib/validation/personal'

/**
 * Personal-info writes. These update only the three columns a user is allowed
 * to change on their own profile — the column-level grant (migration 030)
 * enforces that even if this code were wrong, so flags, disable and referral
 * attribution stay out of reach. The user id comes from the verified session.
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
      phone: parsed.data.phone?.trim() || null,
    })
    .eq('id', user.id)

  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

/** Persist (or clear) the avatar path after a browser-side upload. */
export async function setAvatarPath(path: string | null): Promise<PersonalResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  // Defence in depth: only a path inside the user's own folder, or null.
  if (path !== null && !path.startsWith(`${user.id}/`)) {
    return { ok: false, errorKey: 'invalidPath' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', user.id)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
