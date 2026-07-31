'use server'

import { revalidatePath } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import type { TaskMetric } from '@/lib/tasks/types'
import { actingSuperAdminId } from '@/lib/admin/roles'

export type TaskResult = { ok: true } | { ok: false; message: string }

/* Shared, since 2026-07-31. Five copies of this asked for the literal
   role 'admin' and all five went quiet when that row was renamed. */
const actingAdmin = actingSuperAdminId

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
