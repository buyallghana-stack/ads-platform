import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { TeamMilestones } from '@/lib/tasks/types'

/**
 * One person's team milestone ladder.
 *
 * The subject is an ARGUMENT, read through the service client:
 * `team_milestones` is revoked from every client role because it takes a user
 * id, and it takes a user id because an `auth.uid()` read answers for the
 * admin during "view as" instead of for the person being viewed. Callers pass
 * `getViewerUser()`'s id on member screens, and the admin copy goes through
 * `admin_team_milestones`, which asserts the admin first.
 */

type Raw = {
  team_members: number
  points_per_unit: number
  paid_points: number
  current: { target: number; total_points: number } | null
  next: { target: number; total_points: number; needed: number; payout_points: number } | null
  claimable_task_id: string | null
  claimable_points: number
  rungs: Array<{
    id: string
    name: string
    target: number
    total_points: number
    step_points: number
    claimed_at: string | null
    paid_points: number | null
  }>
  history: Array<{
    name: string
    target: number
    members_at_claim: number
    previous_total_points: number
    milestone_total_points: number
    paid_points: number
    claimed_at: string
  }>
}

export function parseTeamMilestones(raw: unknown): TeamMilestones | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Raw
  return {
    teamMembers: Number(r.team_members ?? 0),
    pointsPerUnit: Math.max(1, Number(r.points_per_unit ?? 100)),
    paidPoints: Number(r.paid_points ?? 0),
    current: r.current
      ? { target: Number(r.current.target), totalPoints: Number(r.current.total_points) }
      : null,
    next: r.next
      ? {
          target: Number(r.next.target),
          totalPoints: Number(r.next.total_points),
          needed: Number(r.next.needed),
          payoutPoints: Number(r.next.payout_points),
        }
      : null,
    claimableTaskId: r.claimable_task_id ?? null,
    claimablePoints: Number(r.claimable_points ?? 0),
    rungs: (r.rungs ?? []).map((x) => ({
      id: x.id,
      name: x.name,
      target: Number(x.target),
      totalPoints: Number(x.total_points),
      stepPoints: Number(x.step_points),
      claimedAt: x.claimed_at,
      paidPoints: x.paid_points === null ? null : Number(x.paid_points),
    })),
    history: (r.history ?? []).map((x) => ({
      name: x.name,
      target: Number(x.target),
      membersAtClaim: Number(x.members_at_claim),
      previousTotalPoints: Number(x.previous_total_points ?? 0),
      milestoneTotalPoints: Number(x.milestone_total_points ?? 0),
      paidPoints: Number(x.paid_points),
      claimedAt: x.claimed_at,
    })),
  }
}

export async function getTeamMilestones(userId: string): Promise<TeamMilestones | null> {
  const admin = createAdminClient()
  const { data } = await admin.rpc('team_milestones', { p_user_id: userId })
  return parseTeamMilestones(data)
}
