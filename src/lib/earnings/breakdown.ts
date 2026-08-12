import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The earnings breakdown, for both businesses.
 *
 * ── EVERYTHING LEAVES HERE IN CEDIS ──
 *
 * Operator, 2026-08-12: both pages are in cedis, not points and not pesewas.
 * So the conversion happens HERE, once, and the types below carry cedis only.
 * There is deliberately no `points` or `minor` field on anything a component
 * receives: a screen cannot render a unit it was never given, and "9,220 pts"
 * appearing on one row of one card is exactly the kind of drift that survives
 * a review.
 *
 * The database still returns points and minor units, because that is what it
 * stores and what reconciles against the ledger. This module is the boundary.
 */

/** One line of a breakdown. `cedis` is a display figure, never a total to sum. */
export type EarningLine = {
  key: string
  cedis: number
}

export type AdsBreakdown = {
  sources: EarningLine[]
  /** Ads, referrals and the rest, already grouped for the page. */
  adsTotal: number
  referralsTotal: number
  earned: number
  balance: number
  paidOut: number
  paidOutNet: number
  fees: number
  pendingOut: number
  refundedOut: number
  plansSpent: number
  plansCount: number
  firstEarnedAt: string | null
}

export type AffiliateBreakdown = {
  sources: EarningLine[]
  earned: number
  balance: number
  pending: number
  reversed: number
  paidOut: number
  paidOutNet: number
  fees: number
  pendingOut: number
  rejectedOut: number
  trainingSpent: number
  trainingCount: number
  salesCount: number
  recruitsCount: number
  firstEarnedAt: string | null
}

/* bigint and numeric arrive as strings over PostgREST once large enough. */
const n = (v: unknown) => Number(v ?? 0)

export async function getAdsBreakdown(userId: string): Promise<AdsBreakdown | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_earnings_breakdown', { p_user_id: userId })
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) return null

  /* The peg, read from the same row the figures came from rather than from
     config again: a rate that changed between the two reads would silently
     restate somebody's history. */
  const perCedi = n(row.points_per_currency_unit) || 100
  const cedis = (points: unknown) => n(points) / perCedi

  const videos = cedis(row.videos_points)
  const surveys = cedis(row.surveys_points)
  const articles = cedis(row.articles_points)
  const refSignup = cedis(row.referral_signup_points)
  const refActivation = cedis(row.referral_activation_points)
  const refPurchase = cedis(row.referral_purchase_points)

  return {
    sources: [
      { key: 'videos', cedis: videos },
      { key: 'surveys', cedis: surveys },
      { key: 'articles', cedis: articles },
      { key: 'referralSignup', cedis: refSignup },
      { key: 'referralActivation', cedis: refActivation },
      { key: 'referralPurchase', cedis: refPurchase },
      { key: 'games', cedis: cedis(row.game_points) },
      { key: 'tasks', cedis: cedis(row.task_points) },
      { key: 'giftCodes', cedis: cedis(row.gift_code_points) },
      /* Kept even at zero would be noise, but it is dropped by the page rather
         than here: an adjustment of exactly zero cannot happen, and a negative
         one MUST be shown. */
      { key: 'adjustments', cedis: cedis(row.adjustment_points) },
    ],
    adsTotal: videos + surveys + articles,
    referralsTotal: refSignup + refActivation + refPurchase,
    earned: cedis(row.earned_points),
    balance: cedis(row.balance_points),
    paidOut: cedis(row.withdrawn_paid_points),
    /* Already cedis in the database: a redemption stores what was actually
       sent, after the fee that was frozen onto the request. */
    paidOutNet: n(row.paid_out_currency),
    fees: n(row.fees_currency),
    pendingOut: cedis(row.withdrawn_pending_points),
    refundedOut: cedis(row.withdrawn_refunded_points),
    plansSpent: n(row.plans_spent_minor) / 100,
    plansCount: n(row.plans_count),
    firstEarnedAt: (row.first_earned_at as string | null) ?? null,
  }
}

export async function getAffiliateBreakdown(userId: string): Promise<AffiliateBreakdown | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_commission_breakdown', { p_user_id: userId })
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) return null

  /* Minor units to cedis. The affiliate business never had points, so this is
     the only conversion it needs. */
  const c = (minor: unknown) => n(minor) / 100

  return {
    sources: [
      { key: 'salesL1', cedis: c(row.sales_l1_minor) },
      { key: 'salesL2', cedis: c(row.sales_l2_minor) },
      { key: 'games', cedis: c(row.game_minor) },
      { key: 'tasks', cedis: c(row.task_minor) },
      { key: 'giftCodes', cedis: c(row.gift_minor) },
      { key: 'adjustments', cedis: c(row.adjustment_minor) },
    ],
    earned: c(row.earned_minor),
    balance: c(row.balance_minor),
    pending: c(row.pending_minor),
    reversed: c(row.reversed_minor),
    paidOut: c(row.withdrawn_paid_minor),
    paidOutNet: c(row.net_paid_minor),
    fees: c(row.fees_minor),
    pendingOut: c(row.withdrawn_pending_minor),
    rejectedOut: c(row.withdrawn_rejected_minor),
    trainingSpent: c(row.training_spent_minor),
    trainingCount: n(row.training_count),
    salesCount: n(row.sales_count),
    recruitsCount: n(row.recruits_count),
    firstEarnedAt: (row.first_earned_at as string | null) ?? null,
  }
}
