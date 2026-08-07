import 'server-only'

import { actingSuperAdminId } from '@/lib/admin/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * The gift-code list for the admin screen.
 *
 * Read through the USER client, not the service client: `admin_list_gift_codes`
 * re-checks `is_admin()` itself, so the caller's own token is the
 * authorisation. Reaching for the service role here would replace a check the
 * database is already making with one this file would have to make correctly.
 */
export type GiftCodeRow = {
  id: string
  code: string
  points: number
  status: 'active' | 'redeemed' | 'revoked'
  note: string | null
  expiresAt: string | null
  createdAt: string
  createdBy: string | null
  redeemedAt: string | null
  redeemedByName: string | null
  redeemedByEmail: string | null
}

export async function getGiftCodes(): Promise<GiftCodeRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_list_gift_codes')

  if (error || !data) return []

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    // numeric/bigint arrive as strings over PostgREST once large enough.
    points: Number(r.points),
    status: r.status as GiftCodeRow['status'],
    note: (r.note as string | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    createdAt: String(r.created_at),
    createdBy: (r.created_by_name as string | null) ?? null,
    redeemedAt: (r.redeemed_at as string | null) ?? null,
    redeemedByName: (r.redeemed_by_name as string | null) ?? null,
    redeemedByEmail: (r.redeemed_by_email as string | null) ?? null,
  }))
}

/* ------------------------------------------------------------------ */
/* COMMISSION gift codes — the affiliate business, paying cedis        */
/* ------------------------------------------------------------------ */

export type CommissionGiftCodeRow = {
  id: string
  code: string
  /** Minor units of cedis. Never points; see the note in the actions file. */
  amountMinor: number
  status: 'active' | 'redeemed' | 'revoked'
  note: string | null
  expiresAt: string | null
  createdAt: string
  redeemedAt: string | null
  redeemedByName: string | null
}

/**
 * ⚠️ Read through the SERVICE client with the acting admin's id, unlike
 * `getGiftCodes` above which uses the user's own token. That is not an
 * inconsistency to tidy: `admin_list_gift_codes` reads `auth.uid()` itself,
 * while every affiliate admin function in this codebase takes `p_admin_id`
 * and asserts on it, because they are also called from places where there is
 * no request-bound session. This follows the affiliate convention because it
 * is an affiliate function.
 */
export async function getCommissionGiftCodes(): Promise<CommissionGiftCodeRow[]> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_list_commission_gift_codes', {
    p_admin_id: adminId,
  })
  if (error || !data) return []

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    // bigint arrives as a string over PostgREST once large enough.
    amountMinor: Number(r.amount_minor),
    status: r.status as CommissionGiftCodeRow['status'],
    note: (r.note as string | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    createdAt: String(r.created_at),
    redeemedAt: (r.redeemed_at as string | null) ?? null,
    redeemedByName: (r.redeemed_by as string | null) ?? null,
  }))
}
