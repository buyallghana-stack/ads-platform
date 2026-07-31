import 'server-only'

import { avatarPublicUrl } from '@/lib/profile/avatar'
import { createClient } from '@/lib/supabase/server'
import {
  EMPTY_TOTALS,
  type TeamData,
  type TeamLevel,
  type TeamMember,
  type TeamTotals,
} from '@/lib/team/types'

/**
 * Data assembly for the Team screen.
 *
 * Read through the USER's client, not the service client. `get_team_summary`
 * and `get_team_members` are SECURITY DEFINER and decide for themselves what a
 * caller may see — each refuses any user id but the caller's own unless the
 * caller is an admin. This is the most sensitive read in the app (it returns
 * other people's phone numbers and balances), which is an argument for keeping
 * the service key well away from it, not for reaching for it.
 *
 * Both calls go out together. They read the same team, but splitting them
 * keeps the totals correct for a team too long to render at once, and one
 * round trip is what a phone on a Ghanaian connection notices.
 */

type RawTotals = {
  member_level: number | string
  people: number | string
  plans_bought: number | string
  plans_value: number | string
  redeemed: number | string
  remaining: number | string
}

type RawMember = {
  member_level: number | string
  member_id: string
  full_name: string | null
  phone: string | null
  avatar_path: string | null
  joined_at: string
  top_plan: string | null
  extra_plans: number | string
  plans_bought: number | string
  plans_value: number | string
  redeemed: number | string
  remaining: number | string
}

/* numeric(18,2) arrives from PostgREST as a STRING, deliberately — it is the
   only way to hand back an exact decimal in JSON. Number() here is safe at
   these magnitudes and is what every other money read in the app does. */
const num = (value: number | string | null | undefined): number => Number(value ?? 0)

const asLevel = (value: number | string): TeamLevel => (num(value) === 2 ? 2 : 1)

export async function getTeamData(userId: string): Promise<TeamData> {
  const supabase = await createClient()

  const [summaryRes, membersRes, profileRes] = await Promise.all([
    supabase.rpc('get_team_summary', { p_user_id: userId }),
    supabase.rpc('get_team_members', { p_user_id: userId }),
    supabase.from('profiles').select('referral_code').eq('id', userId).maybeSingle(),
  ])

  const byLevel: Record<TeamLevel, TeamTotals> = {
    1: { ...EMPTY_TOTALS },
    2: { ...EMPTY_TOTALS },
  }

  for (const row of (summaryRes.data ?? []) as RawTotals[]) {
    byLevel[asLevel(row.member_level)] = {
      people: num(row.people),
      plansBought: num(row.plans_bought),
      plansValue: num(row.plans_value),
      redeemed: num(row.redeemed),
      remaining: num(row.remaining),
    }
  }

  const members: TeamMember[] = ((membersRes.data ?? []) as RawMember[]).map((row) => ({
    level: asLevel(row.member_level),
    id: row.member_id,
    name: row.full_name,
    phone: row.phone,
    avatarUrl: avatarPublicUrl(row.avatar_path),
    joinedAt: row.joined_at,
    /* The function coalesces to the default tier, so this fallback only fires
       if an operator ever deletes the default tier row. A visible word beats
       an empty cell. */
    topPlan: row.top_plan ?? '—',
    extraPlans: num(row.extra_plans),
    plansBought: num(row.plans_bought),
    plansValue: num(row.plans_value),
    redeemed: num(row.redeemed),
    remaining: num(row.remaining),
  }))

  return {
    code: (profileRes.data as { referral_code: string | null } | null)?.referral_code ?? null,
    byLevel,
    members,
  }
}
