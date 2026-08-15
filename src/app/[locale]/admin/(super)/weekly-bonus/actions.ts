'use server'

import { revalidatePath } from 'next/cache'

import { actingSuperAdminId } from '@/lib/admin/roles'
import { createAdminClient } from '@/lib/supabase/admin'

export type CampaignResult = { ok: true } | { ok: false; message: string }

export type CampaignInput = {
  id: string | null
  name: string
  description: string
  min_referrals: number
  max_referrals: number | null
  reward_minor: number
  sort_order: number
  is_active: boolean
}

export async function saveCampaign(campaign: CampaignInput): Promise<CampaignResult> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_save_weekly_bonus_campaign', {
    p_admin_id: adminId,
    p_campaign: campaign,
  })

  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/weekly-bonus')
  return { ok: true }
}

export async function deleteCampaign(campaignId: string): Promise<CampaignResult> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_delete_weekly_bonus_campaign', {
    p_admin_id: adminId,
    p_campaign_id: campaignId,
  })

  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/weekly-bonus')
  return { ok: true }
}
