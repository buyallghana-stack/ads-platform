import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { TaskMetric, UserTask } from '@/lib/tasks/types'

/**
 * The task list, with this user's progress attached.
 *
 * Read through the USER's client: `get_tasks` is SECURITY DEFINER, takes no
 * user id and reads `auth.uid()` itself, so it cannot be pointed at anybody
 * else. `claim_task` is the opposite — revoked from every client role and
 * called through the service client from a server action, because it pays.
 */

type Raw = {
  id: string
  code: string
  name: string
  description: string
  metric: TaskMetric
  target: number | string
  reward_points: number | string
  icon: string
  progress: number | string
  claimed_at: string | null
  claimable: boolean
}

export async function getTasks(): Promise<UserTask[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_tasks')

  return ((data ?? []) as Raw[]).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    metric: t.metric,
    target: Number(t.target),
    rewardPoints: Number(t.reward_points),
    icon: t.icon,
    progress: Number(t.progress),
    claimedAt: t.claimed_at,
    claimable: Boolean(t.claimable),
  }))
}
