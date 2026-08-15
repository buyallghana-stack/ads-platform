import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { actingSuperAdminId } from '@/lib/admin/roles'

export type AdminWeeklyBonusCampaign = {
  id: string
  name: string
  description: string | null
  minReferrals: number
  maxReferrals: number | null
  rewardMinor: number
  rewardGhs: number
  isActive: boolean
  sortOrder: number
  enrolledCount: number
  claimsCount: number
  totalPaidMinor: number
  totalPaidGhs: number
}

export async function getAdminWeeklyBonusCampaigns(): Promise<AdminWeeklyBonusCampaign[]> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return []

  const admin = createAdminClient()
  const { data } = await admin.rpc('admin_list_weekly_bonus_campaigns', { p_admin_id: adminId })

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const rewardMinor = Number(r.reward_minor ?? 0)
    const totalPaidMinor = Number(r.total_paid_minor ?? 0)
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
      enrolledCount: Number(r.enrolled_count ?? 0),
      claimsCount: Number(r.claims_count ?? 0),
      totalPaidMinor,
      totalPaidGhs: totalPaidMinor / 100,
    }
  })
}
