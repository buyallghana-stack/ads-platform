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
  level: 'beginner' | 'professional'
  depth: number
  price_minor: number
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
  content_language: string
  price_minor: number
  list_price_minor: number
  on_sale: boolean
  min_affiliate_tier: 'beginner' | 'professional'
  lessons: number
  owned: boolean
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
        priceMinor: number
        listPriceMinor: number
        onSale: boolean
        minAffiliateTier: 'beginner' | 'professional'
        owned: boolean
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
