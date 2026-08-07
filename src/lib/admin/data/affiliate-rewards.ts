import 'server-only'

import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * What the affiliate games and tasks pay, for the screen that sets it.
 *
 * Every function here takes the ACTING ADMIN's id, because the underlying
 * functions call `assert_admin` themselves rather than trusting the route
 * group. That is the opposite choice from `affiliates.ts`, and deliberate:
 * these decide how much real money a prize draw can hand out, so they fail
 * closed even if a screen is ever mounted somewhere it should not be.
 */

export type AffiliateGame = 'mystery_box' | 'spin_wheel'

export const AFFILIATE_GAMES: AffiliateGame[] = ['mystery_box', 'spin_wheel']

export type AdminAffiliatePrize = {
  id: string
  slot: number
  label: string
  amountMinor: number
  extraPlays: number
  weight: number
  colour: string | null
  weeklyCap: number | null
  isActive: boolean
  timesWon: number
  paidMinor: number
}

export type AdminAffiliateTask = {
  id: string
  code: string
  name: string
  description: string | null
  metric: 'sales' | 'referrals' | 'games_played' | 'leaderboard_rank'
  target: number
  rewardMinor: number
  icon: string | null
  sortOrder: number
  isActive: boolean
  claimedCount: number
  paidMinor: number
  /** ⚠️ How many affiliates could claim this the moment a reward is set.
   *  Tasks are retroactive, so this is money that leaves on save. */
  eligibleNow: number
}

const n = (v: unknown) => Number(v ?? 0)

async function actingAdmin(): Promise<string | null> {
  const user = await getSessionUser()
  return user?.id ?? null
}

export async function getAffiliatePrizes(game: AffiliateGame): Promise<AdminAffiliatePrize[]> {
  const adminId = await actingAdmin()
  if (!adminId) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_list_affiliate_prizes', {
    p_admin_id: adminId,
    p_game: game,
  })
  if (error) throw new Error(`Could not load the prize table: ${error.message}`)

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    slot: n(r.slot),
    label: String(r.label ?? ''),
    amountMinor: n(r.amount_minor),
    extraPlays: n(r.extra_plays),
    weight: n(r.weight),
    colour: (r.colour as string | null) ?? null,
    weeklyCap: r.weekly_cap === null ? null : n(r.weekly_cap),
    isActive: r.is_active === true,
    timesWon: n(r.times_won),
    paidMinor: n(r.paid_minor),
  }))
}

export async function getAffiliateAdminTasks(): Promise<AdminAffiliateTask[]> {
  const adminId = await actingAdmin()
  if (!adminId) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_list_affiliate_tasks', {
    p_admin_id: adminId,
  })
  if (error) throw new Error(`Could not load the tasks: ${error.message}`)

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    metric: r.metric as AdminAffiliateTask['metric'],
    target: n(r.target),
    rewardMinor: n(r.reward_minor),
    icon: (r.icon as string | null) ?? null,
    sortOrder: n(r.sort_order),
    isActive: r.is_active === true,
    claimedCount: n(r.claimed_count),
    paidMinor: n(r.paid_minor),
    eligibleNow: n(r.eligible_now),
  }))
}
