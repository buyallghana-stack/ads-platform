'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { getViewAsSession } from '@/lib/admin/view-as'
import { getSessionUser } from '@/lib/auth/session'
import { getAffiliateTasks, type AffiliateTask } from '@/lib/market/play'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Claiming an affiliate task.
 *
 * ── ONCE, AND THE DATABASE IS WHAT SAYS SO ──
 *
 * `affiliate_task_completions` is unique on (task_id, user_id), so a second
 * claim cannot exist rather than merely being refused. This action does not
 * pre-check whether it was already claimed: between a check here and the
 * insert there is a gap, and two taps on a slow connection is exactly how
 * somebody would find it. The insert is the check.
 *
 * ── AND THE PROGRESS IS NEVER TAKEN FROM THE CLIENT ──
 *
 * The browser sends a task id. Everything else, including whether the target
 * has actually been reached, is recomputed inside `claim_affiliate_task`.
 */

const schema = z.object({ taskId: z.uuid() })

export type ClaimResult =
  | { ok: true; rewardMinor: number; tasks: AffiliateTask[] }
  | { ok: false; message: string; tasks?: AffiliateTask[] }

const GENERIC = 'That could not be claimed. Please try again.'

export async function claimAffiliateTask(input: { taskId: string }): Promise<ClaimResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: GENERIC }
  /* Reads render the viewed account so "view as user" works; a write that
     moves money must never be attributed to the wrong person. */
  if (await getViewAsSession()) return { ok: false, message: GENERIC }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { error } = await admin.rpc('claim_affiliate_task', {
    p_user_id: user.id,
    p_task_id: parsed.data.taskId,
  })

  if (error) {
    const message = humanise(error.message)
    if (message === GENERIC) reportUnexpected(error, 'affiliate.tasks.claim')
    return { ok: false, message, tasks: await safeTasks(user.id) }
  }

  /* The balance on the dashboard, the statement and the task list all change
     the moment this succeeds. */
  revalidatePath('/market')
  revalidatePath('/market/tasks')
  revalidatePath('/commission')

  const tasks = await safeTasks(user.id)
  const claimed = tasks.find((t) => t.id === parsed.data.taskId)
  return { ok: true, rewardMinor: claimed?.rewardMinor ?? 0, tasks }
}

async function safeTasks(userId: string): Promise<AffiliateTask[]> {
  try {
    return await getAffiliateTasks(userId)
  } catch (error) {
    reportUnexpected(error, 'affiliate.tasks.reload')
    return []
  }
}

/** Postgres writes these for a reader; a constraint name is not for a reader. */
function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|duplicate key|syntax error/i.test(clean)) return GENERIC
  return clean
}
