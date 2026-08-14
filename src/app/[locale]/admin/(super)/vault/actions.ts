'use server'

import { revalidatePath } from 'next/cache'

import { getAdminRole } from '@/lib/admin/roles'
import { createAdminClient } from '@/lib/supabase/admin'

export async function toggleVaultEnabledAction(enabled: boolean) {
  const role = await getAdminRole()
  if (role !== 'super_admin') {
    return { ok: false, message: 'Not authorised to change vault configuration' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('app_config')
    .update({ value: enabled ? 'true' : 'false', updated_at: new Date().toISOString() })
    .eq('key', 'vault_enabled')

  if (error) {
    return { ok: false, message: error.message }
  }

  revalidatePath('/[locale]/admin/(super)/vault', 'page')
  revalidatePath('/[locale]/(app)/vault', 'page')
  return { ok: true }
}

export type VaultPlanInput = {
  id?: string
  name: string
  description?: string
  priceMinor: number
  periodDays: number
  dailyReturnPercent: number
  isActive: boolean
  sortOrder?: number
}

export async function saveVaultPlanAction(input: VaultPlanInput) {
  const role = await getAdminRole()
  if (role !== 'super_admin') {
    return { ok: false, message: 'Not authorised to modify vault plans' }
  }

  if (!input.name.trim()) {
    return { ok: false, message: 'Plan name is required' }
  }
  if (input.priceMinor <= 0) {
    return { ok: false, message: 'Price must be greater than zero' }
  }
  if (input.periodDays <= 0) {
    return { ok: false, message: 'Lock duration must be at least 1 day' }
  }
  if (input.dailyReturnPercent <= 0) {
    return { ok: false, message: 'Daily return rate must be greater than zero' }
  }

  const admin = createAdminClient()

  if (input.id) {
    const { error } = await admin
      .from('vault_plans')
      .update({
        name: input.name.trim(),
        description: input.description?.trim() || null,
        price_minor: input.priceMinor,
        period_days: input.periodDays,
        daily_return_percent: input.dailyReturnPercent,
        is_active: input.isActive,
        sort_order: input.sortOrder ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.id)

    if (error) return { ok: false, message: error.message }
  } else {
    const { error } = await admin.from('vault_plans').insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      price_minor: input.priceMinor,
      period_days: input.periodDays,
      daily_return_percent: input.dailyReturnPercent,
      is_active: input.isActive,
      sort_order: input.sortOrder ?? 0,
    })

    if (error) return { ok: false, message: error.message }
  }

  revalidatePath('/[locale]/admin/(super)/vault', 'page')
  revalidatePath('/[locale]/(app)/vault', 'page')
  return { ok: true }
}

export async function deleteVaultPlanAction(planId: string) {
  const role = await getAdminRole()
  if (role !== 'super_admin') {
    return { ok: false, message: 'Not authorised to delete vault plans' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('vault_plans').delete().eq('id', planId)

  if (error) {
    // If foreign key constraint prevents deletion because investments exist, deactivate it instead
    if (error.code === '23503') {
      await admin.from('vault_plans').update({ is_active: false }).eq('id', planId)
      revalidatePath('/[locale]/admin/(super)/vault', 'page')
      return { ok: true, message: 'Plan has active investments and has been deactivated instead.' }
    }
    return { ok: false, message: error.message }
  }

  revalidatePath('/[locale]/admin/(super)/vault', 'page')
  revalidatePath('/[locale]/(app)/vault', 'page')
  return { ok: true }
}
