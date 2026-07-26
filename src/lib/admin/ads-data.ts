import 'server-only'

import { adMediaUrl } from '@/lib/ads/data'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { draftFromRaw, type RawAd } from './ad-draft'
import type { AdDraft, AdListItem, TierOption } from './types'

/**
 * The ad pool, for real. Nothing on this screen comes from preview.ts.
 *
 * Two clients on purpose, and the split is the repo's usual one:
 *
 *   admin_list_ads   the user's own client. It is SECURITY DEFINER but
 *                    re-checks is_admin() for a non-null caller, so the
 *                    answer comes from the same predicate that guards every
 *                    admin table, and a read on every page load needs no
 *                    service key.
 *
 *   admin_get_ad     the service client, because it is revoked from
 *                    `authenticated` outright — it returns the answer key,
 *                    which no browser token may ever ask for. The acting
 *                    admin is named from the verified session and the
 *                    function verifies their role itself (assert_admin).
 */

export type AdsScreenData = {
  ads: AdListItem[]
  tiers: TierOption[]
  /** Points per GHS, for the liability arithmetic. */
  pointsPerGhs: number
  /** Server clock, handed to the client so relative times agree on first paint. */
  now: number
}

export async function getAdsScreenData(): Promise<AdsScreenData> {
  const supabase = await createClient()
  const admin = createAdminClient()

  const [adsRes, tiersRes, rateRes] = await Promise.all([
    supabase.rpc('admin_list_ads'),
    supabase
      .from('tiers')
      .select('id, name, slug, is_default, sort_order')
      .order('sort_order'),
    // app_config through the SERVICE client. The select policy is
    // `is_public OR is_admin()` and this key is private — reading it through
    // the user client happens to work for an admin and returns null silently
    // for everybody else, which is a trap the repo has already fallen into
    // once. The service client makes it work for the same reason every time.
    admin.from('app_config').select('value').eq('key', 'points_per_currency_unit').maybeSingle(),
  ])

  const tiers: TierOption[] = (tiersRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    isDefault: t.is_default,
  }))

  const nameBySlug = new Map(tiers.map((t) => [t.slug, t.name]))

  const ads: AdListItem[] = (adsRes.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    advertiser: row.advertiser_name,
    format: row.format,
    status: row.status,
    points: Number(row.points_reward),
    budget: row.max_completions,
    completions: row.completions_count,
    attempts: row.attempts_count,
    questionCount: row.question_count,
    gradedCount: row.graded_count,
    branchingCount: row.branching_count,
    cueCount: row.cue_count,
    tiers: (row.tier_slugs ?? []).map((slug) => nameBySlug.get(slug) ?? slug),
    videoSource: row.video_source,
    durationSeconds: row.duration_seconds,
    minWatchSeconds: row.min_watch_seconds,
    thumbnailUrl: adMediaUrl(row.thumbnail_path),
    weight: row.weight,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

  return {
    ads,
    tiers,
    pointsPerGhs: Number(rateRes.data?.value ?? 1000),
    now: Date.now(),
  }
}

/**
 * What the editor needs besides the ad itself: the plans it can target and
 * the rate its cost panel converts with. Deliberately NOT getAdsScreenData —
 * editing one ad should not pull the whole pool down with it.
 */
export async function getAdEditorContext(): Promise<{
  tiers: TierOption[]
  pointsPerGhs: number
}> {
  const supabase = await createClient()
  const admin = createAdminClient()

  const [tiersRes, rateRes] = await Promise.all([
    supabase.from('tiers').select('id, name, slug, is_default, sort_order').order('sort_order'),
    admin.from('app_config').select('value').eq('key', 'points_per_currency_unit').maybeSingle(),
  ])

  return {
    tiers: (tiersRes.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      isDefault: t.is_default,
    })),
    pointsPerGhs: Number(rateRes.data?.value ?? 1000),
  }
}

/** One ad as a working draft, or null when it does not exist. */
export async function getAdDraft(adId: string): Promise<AdDraft | null> {
  const user = await getSessionUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_get_ad', {
    p_admin_id: user.id,
    p_ad_id: adId,
  })

  if (error || !data) return null
  return draftFromRaw(data as unknown as RawAd)
}
