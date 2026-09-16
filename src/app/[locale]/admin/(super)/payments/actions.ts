'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { settleFromHub } from '@/lib/payments/hub/resolve'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Ask the hub again about one payment.
 *
 * ⚠️ THIS IS NOT A SECOND WAY TO GRANT A PLAN. It calls `settleFromHub`, the
 * same function the return page and the reconciliation sweep call, which calls
 * the same idempotent fulfilment the hub's confirm endpoint does. Four entry
 * points, one money path. An admin pressing this button cannot produce an
 * outcome the system would not have reached on its own; it only makes it
 * happen now instead of within fifteen minutes.
 *
 * What it is actually for: a customer on the phone saying they paid. Rather
 * than waiting for the sweep, an admin asks the hub and gets today's answer.
 */

export type RecheckResult =
  | { ok: true; state: string; unreachable: boolean }
  | { ok: false; message: string }

export async function recheckWithHub(reference: string): Promise<RecheckResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  /*
    The admin check is asked of the database rather than trusted from the
    session, and it is `assert_admin`, which means SUPER admin. This reaches a
    money path, so it fails closed the same way every other money action does.
  */
  const admin = createAdminClient()
  const { error: notAdmin } = await admin.rpc('assert_admin', { p_admin_id: user.id })
  if (notAdmin) return { ok: false, message: 'Not an administrator.' }

  if (!reference.trim()) return { ok: false, message: 'That payment has no hub reference.' }

  try {
    const settled = await settleFromHub(reference)
    revalidatePath('/admin/payments')
    return { ok: true, state: settled.state, unreachable: settled.unreachable === true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not reach the hub.',
    }
  }
}
