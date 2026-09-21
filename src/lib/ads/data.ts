import 'server-only'

import type { CtaLink } from '@/lib/ads/cta'
import { adMediaUrl, adThumbnailUrl } from '@/lib/ads/media'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Data assembly for the Ads tab.
 *
 * One RPC for the feed and one for the earning status. Both read through the
 * USER's client: `get_ad_feed` and `get_user_earning_status` are SECURITY
 * DEFINER but each refuses a caller asking about somebody else, so the check
 * lives in the database and no service key is needed on a screen that is
 * loaded on every visit.
 *
 * The feed deliberately arrives in ONE call covering all three formats rather
 * than one call per tab. Switching between Videos, Surveys and Articles is a
 * local state change with no spinner and no round trip — which matters much
 * more on a Ghanaian mobile connection than the few extra rows cost.
 */

export type AdFormat = Database['public']['Enums']['ad_format']

export type FeedAd = {
  id: string
  title: string
  description: string | null
  advertiser: string | null
  /**
   * The advertiser's logo, resolved to a public URL, or null when the card
   * should draw their initial instead. The initial stays the fallback rather
   * than becoming an error state: an ad keyed in without a logo has to look
   * deliberate.
   */
  advertiserLogoUrl: string | null
  format: AdFormat
  /** Points this user will actually be paid — base reward x their tier
   *  multiplier, floored exactly as the crediting function does it. */
  points: number
  /** Public URL of the video for uploaded ads; null for YouTube and surveys. */
  videoUrl: string | null
  /** The 11-character YouTube id, when that is the source. */
  youtubeId: string | null
  /** Resolved thumbnail, or null when the card should draw its own cover. */
  thumbnailUrl: string | null
  durationSeconds: number | null
  minWatchSeconds: number | null
  /** How many questions are coming. Zero is a legitimate watch-only ad. */
  questionCount: number
  /**
   * How many of those have a right answer. Zero on a survey means every
   * question is an opinion and nothing the user says can be wrong — which the
   * player says out loud, because being quietly graded on your own opinion is
   * exactly the experience this platform must not give.
   */
  gradedCount: number
  attemptsRemaining: number
  attemptsUsed: number
  /**
   * The advertiser's call to action. Never on a survey — the database refuses
   * one there, so it is always empty and the player never asks. On a LINK ad
   * there is exactly one, and it is the thing that pays.
   */
  ctaLabel: string | null
  ctaLinks: CtaLink[]
  /**
   * The piece the user reads on a LINK ad, before the link that pays.
   *
   * Travels with the feed rather than waiting for a second call: it is a few
   * hundred words, the tab already fetches everything it shows in one round
   * trip, and a spinner between tapping a card and reading it is what makes a
   * cheap phone feel broken. Null on every other format.
   */
  articleBody: string | null
}

export type EarningStatus = {
  balance: number
  tierName: string
  tierSlug: string
  dailyAdCap: number
  completedToday: number
  remainingToday: number
  currencyValue: number
  earningPaused: boolean
  accountDisabled: boolean
  /**
   * True when this user has already hit per_user_daily_points_cap.
   *
   * It cannot be derived from the ad allowance — the two limits diverge once
   * plans stack, so somebody can have 190 ads left and still be unable to earn
   * a single point. Computed here rather than discovered by submitting,
   * because finding out costs the user a whole ad watched for nothing.
   */
  pointsCapReached: boolean
  /**
   * When this account's free earning window closes — null for a plan holder,
   * and null when the platform has no limit set. Null therefore means "no
   * deadline" rather than "we don't know".
   */
  freeEarningEndsAt: number | null
  /** True once it has closed: the ads are still there, but they cannot pay. */
  freeEarningOver: boolean
}

export type AdsData = {
  status: EarningStatus
  videos: FeedAd[]
  surveys: FeedAd[]
  /** Read-an-article-then-click-through ads (2026-07-31). */
  links: FeedAd[]
  /**
   * True when this feed is made of ads they have ALREADY finished — which
   * happens only once they have run out of everything else, and only while
   * `ad_repeat_when_exhausted` is on.
   *
   * Worth saying out loud on the screen: somebody who recognises an ad from
   * yesterday should be told it pays again, not left wondering whether the
   * app is stuck.
   */
  repeating: boolean
  /** Epoch ms of the next daily reset. The counters key off utc_today(), and
   *  Ghana keeps GMT all year, so this is local midnight for this audience. */
  resetAt: number
  /** Server clock at render time. The countdown seeds from this so the first
   *  client render produces the same string the server sent — computing it
   *  from Date.now() on both sides is a guaranteed hydration mismatch, which
   *  is exactly what React #418 was complaining about. */
  now: number
}

/* Media URLs live in lib/ads/media.ts — the admin editor previews an upload
   in the browser and cannot import anything from this `server-only` module. */
export { adMediaUrl }

/** Next UTC midnight, in epoch ms — when daily_earning_counters roll over. */
export function nextDailyReset(now = Date.now()): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0)
}

export async function getAdsData(userId: string): Promise<AdsData> {
  const supabase = await createClient()

  const [feedRes, statusRes, repeatRes] = await Promise.all([
    supabase.rpc('get_ad_feed', { p_user_id: userId, p_limit: 60 }),
    supabase.rpc('get_user_earning_status', { p_user_id: userId }),
    /* Whether this feed is repeats. The same function the feed itself asked,
       rather than anything inferred here — a screen guessing at a money rule
       is how the screen and the rule end up disagreeing. */
    supabase.rpc('may_repeat_ads', { p_user_id: userId }),
  ])

  const rows = feedRes.data ?? []
  const s = statusRes.data?.[0]

  const ads: FeedAd[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    advertiser: r.advertiser_name,
    advertiserLogoUrl: adMediaUrl(r.advertiser_logo_path),
    format: r.format,
    points: Number(r.points_award),
    videoUrl: r.video_source === 'upload' ? adMediaUrl(r.storage_path) : null,
    youtubeId: r.youtube_video_id,
    thumbnailUrl: adThumbnailUrl(r),
    durationSeconds: r.duration_seconds,
    minWatchSeconds: r.format === 'video' || r.format === 'link' ? 10 : r.min_watch_seconds,
    questionCount: r.question_count,
    gradedCount: r.graded_count,
    attemptsRemaining: r.attempts_remaining,
    attemptsUsed: r.attempts_used,
    ctaLabel: r.cta_label,
    // jsonb arrives as unknown; anything malformed simply renders nothing,
    // and ctaHref refuses whatever it cannot turn into a safe link.
    ctaLinks: Array.isArray(r.cta_links) ? (r.cta_links as unknown as CtaLink[]) : [],
    articleBody: r.article_body ?? null,
  }))

  return {
    status: {
      balance: Number(s?.balance ?? 0),
      tierName: s?.tier_name ?? '',
      tierSlug: s?.tier_slug ?? 'free',
      dailyAdCap: s?.daily_ad_cap ?? 0,
      completedToday: s?.ads_completed_today ?? 0,
      remainingToday: s?.ads_remaining_today ?? 0,
      currencyValue: Number(s?.currency_value ?? 0),
      earningPaused: s?.earning_paused ?? false,
      accountDisabled: s?.account_disabled ?? false,
      // Decided in the database. Reading per_user_daily_points_cap from here
      // does NOT work: app_config's select policy is `is_public OR is_admin()`
      // and that key is private, so the read returns null for every ordinary
      // user and the flag would sit permanently false — silently, and only
      // visibly correct when testing as an admin.
      pointsCapReached: s?.points_cap_reached ?? false,
      freeEarningEndsAt: s?.free_earning_ends_at ? Date.parse(s.free_earning_ends_at) : null,
      freeEarningOver: s?.free_earning_over ?? false,
    },
    videos: ads.filter((a) => a.format === 'video'),
    surveys: ads.filter((a) => a.format === 'survey'),
    links: ads.filter((a) => a.format === 'link'),
    repeating: repeatRes.data === true,
    resetAt: nextDailyReset(),
    now: Date.now(),
  }
}
