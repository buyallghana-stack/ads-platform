import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type AdminCommunity = {
  id: string
  name: string
  platform: string
  url: string
  business: 'ads' | 'affiliate' | 'both'
  isActive: boolean
  sortOrder: number
}

/**
 * Every community, including the switched-off ones.
 *
 * Through the USER client: the select policy is `is_active OR is_admin()`, so
 * an administrator sees all of them and the database decides that rather than
 * this file. The same read as the user-facing one, with the filter left off.
 */
export async function getAdminCommunities(): Promise<AdminCommunity[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, platform, url, business, is_active, sort_order')
    .order('sort_order')
    .order('name')

  if (error || !data) return []

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    platform: String(r.platform),
    url: String(r.url),
    business: r.business as AdminCommunity['business'],
    isActive: Boolean(r.is_active),
    sortOrder: Number(r.sort_order ?? 0),
  }))
}
