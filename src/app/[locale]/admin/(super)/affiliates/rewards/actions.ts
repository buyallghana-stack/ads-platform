'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { getViewAsSession } from '@/lib/admin/view-as'
import {
  getAffiliateAdminTasks,
  getAffiliatePrizes,
  type AdminAffiliatePrize,
  type AdminAffiliateTask,
  type AffiliateGame,
} from '@/lib/admin/data/affiliate-rewards'
import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Setting what the affiliate games and tasks pay.
 *
 * These are the only writes in the app that change how much money a prize draw
 * can hand out, so every one of them goes through a function that calls
 * `assert_admin` with the id from the verified session. Nothing about who is
 * acting comes from the payload.
 */

const UNAUTHORISED = 'You are not signed in as an administrator.'
const GENERIC = 'That could not be saved. Please try again.'

const prizeSchema = z.object({
  id: z.string().optional(),
  slot: z.number().int().min(1).max(24),
  label: z.string().trim().min(1).max(60),
  amount_minor: z.number().int().min(0).max(100_000_00),
  extra_plays: z.number().int().min(0).max(10),
  weight: z.number().int().min(0).max(10_000),
  colour: z.string().trim().max(20).nullable().optional(),
  /* 0 means no cap, exactly as the ads table means it. */
  daily_cap: z.number().int().min(0).max(100_000),
  weekly_cap: z.number().int().min(0).max(100_000),
  is_active: z.boolean(),
})

const taskSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  metric: z.enum(['sales', 'referrals', 'games_played', 'leaderboard_rank']),
  target: z.number().int().min(1).max(100_000),
  reward_minor: z.number().int().min(0).max(1_000_000_00),
  icon: z.string().trim().max(8).optional(),
  sort_order: z.number().int().min(0).max(9999),
  is_active: z.boolean(),
})

export type RewardsResult =
  | { ok: true; prizes?: AdminAffiliatePrize[]; tasks?: AdminAffiliateTask[]; note?: string }
  | { ok: false; message: string }

export async function saveAffiliatePrizes(
  game: AffiliateGame,
  prizes: z.infer<typeof prizeSchema>[],
): Promise<RewardsResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (await getViewAsSession()) return { ok: false, message: UNAUTHORISED }

  const parsed = z.array(prizeSchema).min(1).max(24).safeParse(prizes)
  if (!parsed.success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_save_affiliate_prizes', {
    p_admin_id: user.id,
    p_game: game,
    p_prizes: parsed.data,
  })
  if (error) return { ok: false, message: humanise(error) }

  revalidatePath('/admin/affiliates/rewards')
  return { ok: true, prizes: await safePrizes(game) }
}

export async function saveAffiliateTask(
  task: z.infer<typeof taskSchema>,
): Promise<RewardsResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (await getViewAsSession()) return { ok: false, message: UNAUTHORISED }

  const parsed = taskSchema.safeParse(task)
  if (!parsed.success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_save_affiliate_task', {
    p_admin_id: user.id,
    p_task: parsed.data,
  })
  if (error) return { ok: false, message: humanise(error) }

  revalidatePath('/admin/affiliates/rewards')
  revalidatePath('/market/tasks')
  return { ok: true, tasks: await safeTasks() }
}

/**
 * Deleting, or archiving when somebody has already been paid for it.
 *
 * The database decides which, and says so. The screen repeats that word rather
 * than assuming the row is gone: a task that quietly stayed in the list after
 * a "delete" reads as a broken button.
 */
export async function deleteAffiliateTask(taskId: string): Promise<RewardsResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (await getViewAsSession()) return { ok: false, message: UNAUTHORISED }

  const parsed = z.uuid().safeParse(taskId)
  if (!parsed.success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_delete_affiliate_task', {
    p_admin_id: user.id,
    p_task_id: parsed.data,
  })
  if (error) return { ok: false, message: humanise(error) }

  revalidatePath('/admin/affiliates/rewards')
  revalidatePath('/market/tasks')
  return { ok: true, tasks: await safeTasks(), note: String(data ?? '') }
}

/**
 * How many affiliates a target would pay RIGHT NOW.
 *
 * Asked while the operator is still typing, because these tasks are
 * retroactive: a reward set on "make your first sale" pays everybody who has
 * ever made one, the moment they open the screen. Finding that out after
 * saving is finding out too late.
 */
export async function affiliateTaskExposure(input: {
  metric: 'sales' | 'referrals' | 'games_played' | 'leaderboard_rank'
  target: number
  taskId?: string
}): Promise<{ people: number } | null> {
  const user = await getSessionUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_affiliate_task_exposure', {
    p_admin_id: user.id,
    p_metric: input.metric,
    p_target: Math.max(1, Math.floor(input.target || 1)),
    p_task_id: input.taskId ?? undefined,
  })
  if (error || !data) return null

  return { people: Number((data as Record<string, unknown>).people ?? 0) }
}

async function safePrizes(game: AffiliateGame) {
  try {
    return await getAffiliatePrizes(game)
  } catch (error) {
    reportUnexpected(error, 'admin.affiliateRewards.prizes')
    return undefined
  }
}

async function safeTasks() {
  try {
    return await getAffiliateAdminTasks()
  } catch (error) {
    reportUnexpected(error, 'admin.affiliateRewards.tasks')
    return undefined
  }
}

/** Postgres writes these for an operator; a constraint name is not for one. */
function humanise(error: { message: string }): string {
  const clean = error.message.trim()
  if (!clean || /violates|constraint|syntax error|invalid input/i.test(clean)) return GENERIC
  return clean
}
