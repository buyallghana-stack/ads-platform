import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Read side of the affiliate business.
 *
 * Through the ADMIN client, not the RLS user client, because every Phase 2 RPC
 * is server-only by the convention migration 127 set: revoked from `anon` and
 * `authenticated`, granted to `service_role`. The function takes the user id
 * rather than reading `auth.uid()`, which is also what makes "view as user"
 * work — the layout has already decided whose account is on screen.
 */

/** The four states with no design precedent, plus `lapsed`. See DESIGN.md. */
export type AffiliateState = 'none' | 'pending' | 'active' | 'lapsed' | 'suspended'

export type TrainingOffer = {
  product_id: string
  slug: string
  title: string
  description: string | null
  cover_path: string | null
  level: 'beginner' | 'professional'
  /** Commission levels this program grants: 1 pays on your own sales, 2 also
   *  pays an override on sales by affiliates you bring in. This is the whole
   *  difference between the two programs, so it is what the join screen leads
   *  with — not the price. */
  depth: number
  price_minor: number
  list_price_minor: number
  validity_days: number
  grace_days: number
  renewal_price_minor: number | null
  /** Percent of the course that must be finished before the account switches
   *  on and links start paying. */
  threshold: number
  certificate: boolean
  lessons: number
}

export type TrainingProgress = {
  product_id: string
  slug: string
  title: string
  level: 'beginner' | 'professional'
  /** Lessons completed ÷ total, as a whole percent. */
  percent: number
  /** The percent at which the affiliate account switches on. */
  threshold: number
  certificate: boolean
}

export type AffiliateDashboard = {
  state: AffiliateState
  affiliate_id?: string
  code?: string
  /** Commission levels this account can currently earn: 0, 1 or 2. */
  depth?: number
  tier?: 'beginner' | 'professional' | null
  expires_at?: string | null
  grace_ends_at?: string | null
  days_left?: number | null
  balance_minor?: number
  pending_minor?: number
  earned_minor?: number
  /** Positive figure. The RPC flips the stored sign so the UI never prints
   *  a minus in front of a number that already has one. */
  reversed_minor?: number
  paid_minor?: number
  clicks_30d?: number
  conversions_30d?: number
  training?: TrainingProgress[]
  training_offers?: TrainingOffer[]
  payouts_enabled?: boolean
  payout_minimum_minor?: number
}

/**
 * `cache` so the layout and the page can both ask without a second round trip.
 * The audience is on mobile data; the app layout already treats a spare query
 * per page as a cost worth avoiding.
 */
export const getAffiliateDashboard = cache(async (userId: string): Promise<AffiliateDashboard> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('affiliate_dashboard', { p_user_id: userId })

  /*
    A read failure returns the `none` state rather than throwing. This screen
    is reachable by every signed-in user, including everyone who will never be
    an affiliate, and a 500 on the second business's front door is a worse
    outcome than showing them the training offer. The error is still surfaced
    to logging by the client itself.
  */
  if (error || !data) return { state: 'none', training_offers: [] }
  return data as unknown as AffiliateDashboard
})

/* ------------------------------------------------------------------ */
/* Performance over time                                               */
/* ------------------------------------------------------------------ */

export type PerformancePoint = {
  /** `YYYY-MM-DD`, UTC. */
  day: string
  earned_minor: number
  clicks: number
  conversions: number
}

export type AffiliatePerformance = {
  days: number
  /** Gap-filled: every day in the window is present, zeros included. A chart
   *  that skips absent days draws a line across them and claims activity. */
  series: PerformancePoint[]
  earned_minor: number
  clicks: number
  /** Distinct people, not clicks. ⚠️ Window-level only, and absent from
   *  `series` on purpose: somebody who clicks twice in a week is one person in
   *  the weekly figure and would be two if daily counts were added. */
  visitors: number
  conversions: number
  /** The window immediately before this one, for the "vs last N days" delta. */
  prev_earned_minor: number
  prev_clicks: number
  prev_visitors: number
  prev_conversions: number
}

const EMPTY_PERFORMANCE = (days: number): AffiliatePerformance => ({
  days,
  series: [],
  earned_minor: 0,
  clicks: 0,
  visitors: 0,
  conversions: 0,
  prev_earned_minor: 0,
  prev_clicks: 0,
  prev_visitors: 0,
  prev_conversions: 0,
})

export const getAffiliatePerformance = cache(
  async (userId: string, days = 30): Promise<AffiliatePerformance> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('affiliate_performance', {
      p_user_id: userId,
      p_days: days,
    })
    if (error || !data) return EMPTY_PERFORMANCE(days)
    return data as unknown as AffiliatePerformance
  },
)

/**
 * Period-over-period change, as a whole percent, or `null` when there is
 * nothing to compare against.
 *
 * `null` rather than 0 or ∞ for a previous window of zero. Going from GHS 0 to
 * GHS 400 is not "+100%" and it is not "+∞%" — it is a first sale, and the
 * honest thing for a comparison to say when there is no baseline is nothing.
 * Printing a percentage there is how a dashboard ends up announcing "+100%" to
 * somebody every single week they earn anything at all.
 */
export function periodDelta(now: number, before: number): number | null {
  if (before <= 0) return null
  return Math.round(((now - before) / before) * 100)
}

/* ------------------------------------------------------------------ */
/* The statement                                                       */
/* ------------------------------------------------------------------ */

/** Four different events. Never collapsed to the sign of the amount: a
 *  reversal and a payout are both money leaving, and confusing them is the
 *  difference between "I was paid" and "a sale was cancelled". */
export type CommissionEntryType = 'credit' | 'reversal' | 'payout' | 'adjustment'

export type StatementEntry = {
  id: string
  entry_type: CommissionEntryType
  amount_minor: number
  /** 1 = your own sale, 2 = an override on somebody you recruited. */
  level: number | null
  status: 'pending' | 'cleared' | 'requested' | 'paid' | 'reversed'
  /** When a pending entry becomes withdrawable. */
  clears_at: string | null
  reason: string | null
  created_at: string
  product_title: string | null
  product_slug: string | null
}

export type StatementPayout = {
  id: string
  amount_minor: number
  fee_minor: number
  /** What actually lands. The figure the affiliate will check against. */
  net_minor: number
  fee_percent: number | null
  method: string
  status: 'requested' | 'approved' | 'paid' | 'rejected' | 'cancelled'
  created_at: string
  paid_at: string | null
  failure_reason: string | null
}

export const getAffiliateStatement = cache(
  async (
    userId: string,
    limit = 100,
  ): Promise<{ entries: StatementEntry[]; payouts: StatementPayout[] }> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('affiliate_statement', {
      p_user_id: userId,
      p_limit: limit,
    })
    if (error || !data) return { entries: [], payouts: [] }
    return data as unknown as { entries: StatementEntry[]; payouts: StatementPayout[] }
  },
)

/* ------------------------------------------------------------------ */
/* The shop                                                            */
/* ------------------------------------------------------------------ */

export type ShopProduct = {
  id: string
  slug: string
  title: string
  description: string | null
  kind: string
  purpose: 'vendor_product' | 'training_program'
  cover_path: string | null
  category: string | null
  /** Falls back to the platform name in the UI: a TRAINING product structurally
   *  cannot have a vendor (`products_training_has_no_vendor`) because it is the
   *  Owner's own, so these are null on exactly the products the shop leads
   *  with. */
  instructor_name: string | null
  instructor_headline: string | null
  instructor_avatar: string | null
  content_language: string
  price_minor: number
  list_price_minor: number
  on_sale: boolean
  min_affiliate_tier: 'beginner' | 'professional'
  lessons: number
  quizzes: number
  /** Total course length. Summed from lessons rather than stored, so it cannot
   *  disagree with the curriculum. */
  seconds: number
  owned: boolean
  /** How far through, for the progress bar on an owned card. */
  percent: number
  saved: boolean
  /** Level-one commission percentage this product publishes. Null when it has
   *  no active affiliate program — which is not the same as 0%. */
  l1_rate: number | null
  /** What that rate is worth in pesewas at the current price. Computed in
   *  Postgres with the ledger's own expression, never multiplied here: a
   *  browser float and an exact numeric disagree on half a pesewa, and the card
   *  would advertise a figure the payout does not match. */
  l1_earn_minor: number | null
  /** Per ROW, not per user: `min_affiliate_tier` lives on the product, so a
   *  beginner can promote some of this grid and not the rest. */
  can_promote: boolean
}

export type ShopDetail =
  | { ok: false }
  | {
      ok: true
      product: {
        id: string
        slug: string
        title: string
        description: string | null
        kind: string
        purpose: 'vendor_product' | 'training_program'
        coverPath: string | null
        category: string | null
        vendorName: string | null
        outcomes: string[]
        updatedAt: string
        priceMinor: number
        listPriceMinor: number
        onSale: boolean
        minAffiliateTier: 'beginner' | 'professional'
        owned: boolean
        percent: number
        lessons: number
        quizzes: number
        seconds: number
      }
      training: {
        level: 'beginner' | 'professional'
        commissionDepth: number
        validityDays: number
        renewalPriceMinor: number | null
        activationThreshold: number
        certificate: boolean
      } | null
      sections: {
        title: string
        position: number
        lessons: { title: string; kind: string; seconds: number | null; preview: boolean }[]
      }[]
    }

export const getShopProducts = cache(async (userId?: string): Promise<ShopProduct[]> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('shop_products', { p_user_id: userId ?? undefined })
  if (error || !data) return []
  return data as unknown as ShopProduct[]
})

export const getShopProduct = cache(
  async (slug: string, userId?: string): Promise<ShopDetail> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('shop_product', {
      p_slug: slug,
      p_user_id: userId ?? undefined,
    })
    if (error || !data) return { ok: false }
    return data as unknown as ShopDetail
  },
)

/**
 * What an affiliate needs before promoting a product: what they earn on it in
 * cash, whether they may, and their link.
 *
 * The shape lives here rather than beside a component, so the read survives the
 * UI being rebuilt. `l1EarnMinor` is computed in Postgres with the same price
 * source and rounding `pay_conversion_commissions` uses — never multiplied in a
 * browser, or the number shown drifts from the number paid.
 */
export type PromoteInfo = {
  ok: boolean
  canPromote?: boolean
  /** Four distinct ways to be unable to promote, each needing its own sentence
   *  and its own next step. Never collapsed to a boolean. */
  reason?: 'no_account' | 'pending' | 'lapsed' | 'tier' | 'suspended' | null
  code?: string | null
  tier?: 'beginner' | 'professional' | null
  depth?: number
  minTier?: 'beginner' | 'professional'
  priceMinor?: number
  l1Rate?: number | null
  l2Rate?: number | null
  l1EarnMinor?: number | null
  l2EarnMinor?: number | null
  windowDays?: number
  holdDays?: number
}

export const getPromoteInfo = cache(
  async (userId: string, productId: string): Promise<PromoteInfo | null> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('affiliate_promote_info', {
      p_user_id: userId,
      p_product_id: productId,
    })
    if (error || !data) return null
    return data as unknown as PromoteInfo
  },
)

/* ------------------------------------------------------------------ */
/* The Learn tab                                                       */
/* ------------------------------------------------------------------ */

export type EarnedCertificate = {
  id: string
  productId: string
  slug: string
  title: string
  coverPath: string | null
  category: string | null
  /** Null on certificates issued before grades existed — renders as no grade,
   *  never as zero. */
  grade: number | null
  issuedAt: string
  code: string
  instructor: string | null
}

export type OngoingCourse = {
  productId: string
  slug: string
  title: string
  description: string | null
  coverPath: string | null
  category: string | null
  instructor: string | null
  percent: number
  lessons: number
  /** What the reference puts on the row: "08 lectures left". A better thing to
   *  show than a percentage alone — a percentage says how far you have come, a
   *  count says how much is in the way. */
  lessonsLeft: number
}

export const getMyLearning = cache(
  async (userId: string): Promise<{ certificates: EarnedCertificate[]; ongoing: OngoingCourse[] }> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('my_learning', { p_user_id: userId })
    if (error || !data) return { certificates: [], ongoing: [] }
    return data as unknown as { certificates: EarnedCertificate[]; ongoing: OngoingCourse[] }
  },
)
