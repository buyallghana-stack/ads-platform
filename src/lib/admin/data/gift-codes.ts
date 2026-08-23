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
