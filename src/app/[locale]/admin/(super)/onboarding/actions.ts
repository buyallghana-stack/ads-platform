'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

export type SaveResult = { ok: boolean; message?: string }

/**
 * Reordering and switching off walkthrough steps.
 *
 * The WHOLE list is sent every time, never one row. A reorder written a row at
 * a time leaves two steps claiming the same position for as long as the
 * remaining writes take, and the walkthrough would show one of them twice to
 * anybody loading a page in that window.
 */
export async function saveOnboardingSteps(
  steps: Array<{ key: string; sortOrder: number; isEnabled: boolean }>,
): Promise<SaveResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_save_onboarding_steps', {
    p_admin_id: user.id,
    p_steps: steps,
  })

  if (error) {
    /* `admin_save_onboarding_steps` raises in operator language for the one
       rule it enforces (no celebration without a first ad behind it), so that
       message is shown rather than swallowed into "something went wrong". */
    reportUnexpected(error, 'admin.onboarding.save')
    return { ok: false, message: error.message.replace(/^.*?:\s*/, '') }
  }

  revalidatePath('/admin/onboarding')
  // Every signed-in screen renders the walkthrough, so the change has to reach
  // the whole app and not just this panel.
  revalidatePath('/', 'layout')
  return { ok: true }
}
