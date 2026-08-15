'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ClaimResult } from '@/lib/tasks/types'
import type {
  ClaimResult as WeeklyClaimResult,
  EnrollResult,
  UnenrollResult,
} from '@/lib/weekly-bonus/types'

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

// ---------------------------------------------------------------------------
// Weekly Bonus
// ---------------------------------------------------------------------------

/**
 * Enroll in the weekly bonus programme.
 *
 * Self-scoped: `enroll_weekly_bonus` reads `auth.uid()` itself, so the RPC
 * runs through the user's own client. The function checks whether the user
 * has enough active referrals and auto-matches them to the correct campaign
 * tier.
 */
export async function enrollWeeklyBonus(): Promise<EnrollResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'not_signed_in' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('enroll_weekly_bonus')

  if (error) {
    reportUnexpected(error, 'weekly_bonus.enroll')
    return { ok: false, reason: 'error' }
  }

  const result = (data ?? {}) as Record<string, unknown>

  if (result.outcome === 'ok') {
    revalidatePath('/dashboard')
    revalidatePath('/tasks')

    const mc = result.matched_campaign as Record<string, unknown> | null
    return {
      ok: true,
      matchedCampaign: mc
        ? {
            id: String(mc.id),
            name: String(mc.name ?? ''),
            description: (mc.description as string) ?? null,
            minReferrals: Number(mc.min_referrals ?? 0),
            maxReferrals: mc.max_referrals != null ? Number(mc.max_referrals) : null,
            rewardMinor: Number(mc.reward_minor ?? 0),
            rewardGhs: Number(mc.reward_minor ?? 0) / 100,
            isActive: true,
            sortOrder: Number(mc.sort_order ?? 0),
          }
        : { id: '', name: '', description: null, minReferrals: 0, maxReferrals: null, rewardMinor: 0, rewardGhs: 0, isActive: true, sortOrder: 0 },
    }
  }

  const known = ['not_qualified', 'already_enrolled', 'no_campaigns'] as const
  const reason = known.find((r) => r === result.outcome)
  return { ok: false, reason: reason ?? 'error', message: result.message as string | undefined }
}

/**
 * Leave the weekly bonus programme.
 */
export async function unenrollWeeklyBonus(): Promise<UnenrollResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'not_signed_in' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('unenroll_weekly_bonus')

  if (error) {
    reportUnexpected(error, 'weekly_bonus.unenroll')
    return { ok: false, reason: 'error' }
  }

  const result = (data ?? {}) as Record<string, unknown>

  if (result.outcome === 'ok') {
    revalidatePath('/dashboard')
    revalidatePath('/tasks')
    return { ok: true }
  }

  return { ok: false, reason: result.outcome === 'not_enrolled' ? 'not_enrolled' : 'error' }
}

/**
 * Claim the weekly bonus for the most recently completed week.
 *
 * Goes through the service client because it pays — same pattern as
 * `claimTask`. The user id comes from the verified session, never from the
 * payload.
 */
export async function claimWeeklyBonus(): Promise<WeeklyClaimResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'not_signed_in' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('claim_weekly_bonus', {
    p_user_id: user.id,
  })

  if (error) {
    reportUnexpected(error, 'weekly_bonus.claim')
    return { ok: false, reason: 'error' }
  }

  const result = (data ?? {}) as unknown as Record<string, unknown>

  if (result.outcome === 'ok') {
    revalidatePath('/dashboard')
    revalidatePath('/tasks')
    return {
      ok: true,
      rewardGhs: Number(result.reward_minor ?? 0) / 100,
      campaignName: String(result.campaign_name ?? ''),
      weekStart: String(result.week_start ?? ''),
    }
  }

  const known = ['not_enrolled', 'not_qualified', 'already_claimed', 'week_not_ended', 'account_disabled'] as const
  const reason = known.find((r) => r === result.outcome)

  return { ok: false, reason: reason ?? 'error', message: result.message as string | undefined }
}
