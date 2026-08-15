import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { WeeklyBonusStatus, WeeklyBonusCampaign } from '@/lib/weekly-bonus/types'

/**
 * Weekly bonus status for the signed-in user.
 *
 * Read through the USER's client: `get_weekly_bonus_status` is SECURITY
 * DEFINER and reads `auth.uid()` itself, so it cannot be pointed at anybody
 * else. The claim path uses the service client because it pays.
 */
export async function getWeeklyBonusStatus(): Promise<WeeklyBonusStatus> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_weekly_bonus_status')

  if (!data) {
    return {
      activeReferrals: 0,
      enrolled: false,
      enrollmentId: null,
      matchedCampaign: null,
      canClaim: false,
      claimableWeek: null,
      lastClaimWeek: null,
      campaigns: [],
    }
  }

  const raw = data as Record<string, unknown>
  const campaigns = ((raw.campaigns ?? []) as Array<Record<string, unknown>>).map(mapCampaign)
  const matched = raw.matched_campaign ? mapCampaign(raw.matched_campaign as Record<string, unknown>) : null

  return {
    activeReferrals: Number(raw.active_referrals ?? 0),
    enrolled: Boolean(raw.enrolled),
    enrollmentId: (raw.enrollment_id as string) ?? null,
    matchedCampaign: matched,
    canClaim: Boolean(raw.can_claim),
    claimableWeek: (raw.claimable_week as string) ?? null,
    lastClaimWeek: (raw.last_claim_week as string) ?? null,
    campaigns,
  }
}

function mapCampaign(r: Record<string, unknown>): WeeklyBonusCampaign {
  const rewardMinor = Number(r.reward_minor ?? 0)
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    description: (r.description as string) ?? null,
    minReferrals: Number(r.min_referrals ?? 0),
    maxReferrals: r.max_referrals != null ? Number(r.max_referrals) : null,
    rewardMinor,
    rewardGhs: rewardMinor / 100,
    isActive: Boolean(r.is_active ?? true),
    sortOrder: Number(r.sort_order ?? 0),
  }
}
