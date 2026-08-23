import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type CommunityPlatform =
  | 'whatsapp'
  | 'telegram'
  | 'x'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'other'

export type Community = {
  id: string
  name: string
  platform: CommunityPlatform
  url: string
}

/**
 * The communities a signed-in person may join.
 *
 * Read through the USER client on purpose. The select policy is
 * `is_active OR is_admin()`, so a switched-off community disappears for
 * everybody except an administrator without this file having to remember to
 * filter — and if the policy is ever loosened, one place is wrong rather than
 * every caller.
 *
 * `business` is 'ads' or 'affiliate'; rows marked 'both' appear on either side.
 */
export async function getCommunities(business: 'ads' = 'ads'): Promise<Community[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, platform, url, business, is_active, sort_order')
    .eq('is_active', true)
    .in('business', [business, 'both'])
    .order('sort_order')
    .order('name')

  if (error || !data) return []

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    platform: r.platform as CommunityPlatform,
    url: String(r.url),
  }))
}
