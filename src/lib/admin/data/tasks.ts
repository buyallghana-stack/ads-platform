import 'server-only'

import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TaskMetric } from '@/lib/tasks/types'

/**
 * The admin's view of the tasks.
 *
 * `eligibleNow` is the number that stops a task being priced by feel. Tasks
 * are retroactive, so saving "watch 100 ads for 1,500 points" can owe every
 * long-standing user at once — this is how many people could claim it the
 * moment it goes live, and the screen multiplies it by the reward.
 */

export type AdminTask = {
  id: string
  code: string
  name: string
  description: string
  metric: TaskMetric
  target: number
  rewardPoints: number
  icon: string
  sortOrder: number
  isActive: boolean
  claimedCount: number
  pointsPaid: number
  eligibleNow: number
}

async function actingAdmin(): Promise<string | null> {
  const user = await getSessionUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .maybeSingle()
  return data ? user.id : null
}

export async function getAdminTasks(): Promise<AdminTask[]> {
  const adminId = await actingAdmin()
  if (!adminId) return []

  const admin = createAdminClient()
  const { data } = await admin.rpc('admin_list_tasks', { p_admin_id: adminId })

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    description: String(r.description),
    metric: r.metric as TaskMetric,
    target: Number(r.target),
    rewardPoints: Number(r.reward_points),
    icon: String(r.icon ?? 'Target'),
    sortOrder: Number(r.sort_order ?? 0),
    isActive: Boolean(r.is_active),
    claimedCount: Number(r.claimed_count ?? 0),
    pointsPaid: Number(r.points_paid ?? 0),
    eligibleNow: Number(r.eligible_now ?? 0),
  }))
}
