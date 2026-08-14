'use server'

import { revalidatePath } from 'next/cache'

import { actingSuperAdminId } from '@/lib/admin/roles'
import { createAdminClient } from '@/lib/supabase/admin'

export type CommunityActionResult = { ok: true } | { ok: false; message: string }

export type SaveCommunityInput = {
  id?: string | null
  name: string
  platform: string
  url: string
  business: 'ads' | 'affiliate' | 'both'
  isActive: boolean
  sortOrder: number
}

/**
 * ⚠️ EVERY ARGUMENT IS SENT, AND AS `null` RATHER THAN `undefined`.
 * PostgREST resolves an overload from the argument NAMES in the request and
 * supabase-js drops undefined keys, which produced "could not find the
 * function" on the coupon screen from code that typechecked. See the note in
 * the coupons actions.
 */
export async function saveCommunity(input: SaveCommunityInput): Promise<CommunityActionResult> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_save_community', {
    p_admin_id: adminId,
    p_id: (input.id ?? null) as unknown as string,
    p_name: input.name,
    p_platform: input.platform as never,
    p_url: input.url.trim(),
    p_business: input.business,
    p_is_active: input.isActive,
    p_sort_order: input.sortOrder,
  })

  /* Surfaced verbatim: the function refuses in operator language, including
     the one about a link having to start with https. */
  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/communities')
  revalidatePath('/profile')
  return { ok: true }
}

export async function deleteCommunity(id: string): Promise<CommunityActionResult> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_delete_community', { p_admin_id: adminId, p_id: id })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/communities')
  revalidatePath('/profile')
  return { ok: true }
}
