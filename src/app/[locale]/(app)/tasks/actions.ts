'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ClaimResult } from '@/lib/tasks/types'

/**
 * Claiming a finished task.
 *
 * The client sends a task id and nothing else — not its progress, not whether
 * it thinks the task is done. `claim_task` re-derives the metric from the
 * same function that drew the progress bar and refuses if it falls short, so
 * a stale button or a hand-crafted request gets `not_finished` rather than
 * points.
 */
export async function claimTask(taskId: string): Promise<ClaimResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'not_signed_in' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('claim_task', {
    p_user_id: user.id,
    p_task_id: taskId,
  })

  if (error) {
    reportUnexpected(error, 'tasks.claim', { taskId })
    return { ok: false, reason: 'error' }
  }

  const result = (data ?? {}) as { outcome?: string; points?: number; name?: string }

  if (result.outcome === 'ok') {
    // The balance, the history and the bell all moved.
    revalidatePath('/dashboard')
    revalidatePath('/tasks')
    return { ok: true, points: Number(result.points ?? 0), name: String(result.name ?? '') }
  }

  const known = ['not_found', 'not_finished', 'already_claimed', 'account_disabled'] as const
  const reason = known.find((r) => r === result.outcome)

  return { ok: false, reason: reason ?? 'error' }
}
