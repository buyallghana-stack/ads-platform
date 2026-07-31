'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TaskMetric } from '@/lib/tasks/types'

export type TaskResult = { ok: true } | { ok: false; message: string }

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

export type TaskInput = {
  id: string | null
  code: string
  name: string
  description: string
  metric: TaskMetric
  target: number
  reward_points: number
  icon: string
  sort_order: number
  is_active: boolean
}

export async function saveTask(task: TaskInput): Promise<TaskResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_save_task', {
    p_admin_id: adminId,
    p_task: task,
  })

  // Raised in operator language — including the refusal to move a goal that
  // people have already completed. Surfaced verbatim rather than reworded.
  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/tasks')
  return { ok: true }
}

export async function deleteTask(taskId: string): Promise<TaskResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_delete_task', {
    p_admin_id: adminId,
    p_task_id: taskId,
  })

  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/tasks')
  return { ok: true }
}
