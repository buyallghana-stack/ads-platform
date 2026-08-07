import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The affiliate business, as an operator sees it.
 *
 * ── WHY THE SERVICE CLIENT, AND WHY THAT IS SAFE HERE ──
 *
 * Unlike `admin_list_redemptions`, the Phase 2 read functions do NOT re-check
 * `is_admin()` — they are `security definer` and granted to `service_role`
 * alone (verified: anon, authenticated and public hold no EXECUTE on any of
 * the eight). So they are unreachable with a browser token by construction,
 * and what stands between a support agent and this data is the route group:
 * every screen calling this module lives under `admin/(super)/`, whose layout
 * refuses anybody who is not a super admin.
 *
 * ⚠️ THAT MAKES THE FOLDER LOAD-BEARING. Moving one of these screens out of
 * `(super)/` moves the guard with it and silently opens the whole affiliate
 * ledger. Writes fail closed regardless — `decide_commission_payout`,
 * `mark_commission_payout_paid` and `admin_set_affiliate_status` all call
 * `assert_admin`, which is super admin only — but reads would not.
 *
 * ── MONEY ARRIVES AS STRINGS ──
 *
 * `bigint` and `numeric` come over PostgREST as strings once they are large
 * enough. Every figure is `Number()`ed once, here, so nothing downstream ever
 * does string arithmetic on money.
 */

export type CommissionPayoutStatus = 'requested' | 'approved' | 'paid' | 'rejected' | 'cancelled'

export type CommissionPayout = {
  id: string
  requestedAt: string
  affiliateId: string
  affiliateCode: string
  name: string
  method: 'mobile_money' | 'crypto'
  amountMinor: number
  feeMinor: number
  /** What actually leaves. The figure the operator sends. */
  netMinor: number
  /** Crypto is owed in COIN, frozen at request — locked operator rule. */
  coin?: string
  coinAmount?: number
  /** Already masked by the RPC; this module never sees the whole number. */
  destination: string
  /** What the affiliate still holds AFTER this request took its hold. */
  balanceAfter: number
  status: CommissionPayoutStatus
  reviewNotes?: string
  paidAt?: string
}

export type AffiliateRow = {
  affiliateId: string
  userId: string
  name: string
  email: string
  code: string
  status: 'pending' | 'active' | 'suspended'
  /** Levels they can currently earn: 0, 1 or 2. */
  depthNow: number
  tier: string | null
  activatedAt: string | null
  promotionEnds: string | null
  uplineName: string | null
  recruits: number
  clicks: number
  conversions: number
  grossMinor: number
  reversedMinor: number
  paidOutMinor: number
  balanceMinor: number
  pendingMinor: number
  joinedAt: string
}

export type CommissionTotals = {
  pendingMinor: number
  clearedMinor: number
  reversedMinor: number
  paidMinor: number
  /** Cleared but not yet paid — what the platform owes today. */
  owedMinor: number
  affiliatesOwed: number
}

const n = (v: unknown) => Number(v ?? 0)

/**
 * Every commission withdrawal, whatever its state.
 *
 * Unfiltered on purpose, exactly like the points queue: the table's tabs
 * filter one list client-side, and paginating underneath them would let a tab
 * read "12" and then list four. `p_status => null` is what asks for all of
 * them — the argument defaults to `'requested'`, so omitting it would return
 * the queue and quietly hide every decided row.
 */
export async function getCommissionPayouts(): Promise<CommissionPayout[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('admin_list_commission_payouts', {
    p_status: null as unknown as string,
  })

  if (error) {
    /* An operator staring at an empty queue that is not empty would approve
       nothing and assume there was nothing to approve. Fail loudly. */
    throw new Error(`Could not load the commission queue: ${error.message}`)
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.payout_id),
    requestedAt: String(r.requested_at),
    affiliateId: String(r.affiliate_id),
    affiliateCode: String(r.affiliate_code ?? ''),
    name: String(r.name ?? ''),
    method: r.method === 'crypto' ? 'crypto' : 'mobile_money',
    amountMinor: n(r.amount_minor),
    feeMinor: n(r.fee_minor),
    netMinor: n(r.net_minor),
    coin: (r.coin_code as string | null) ?? undefined,
    coinAmount: r.coin_amount === null ? undefined : n(r.coin_amount),
    destination: String(r.destination ?? ''),
    balanceAfter: n(r.balance_after),
    status: r.status as CommissionPayoutStatus,
    reviewNotes: (r.review_notes as string | null) ?? undefined,
    paidAt: (r.paid_at as string | null) ?? undefined,
  }))
}

export async function getAffiliates(): Promise<AffiliateRow[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('admin_list_affiliates', { p_scope: 'all' })
  if (error) throw new Error(`Could not load affiliates: ${error.message}`)

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    affiliateId: String(r.affiliate_id),
    userId: String(r.user_id),
    name: String(r.name ?? ''),
    email: String(r.email ?? ''),
    code: String(r.affiliate_code ?? ''),
    status: r.status as AffiliateRow['status'],
    depthNow: n(r.depth_now),
    tier: (r.tier as string | null) ?? null,
    activatedAt: (r.activated_at as string | null) ?? null,
    promotionEnds: (r.promotion_ends as string | null) ?? null,
    uplineName: (r.upline_name as string | null) ?? null,
    recruits: n(r.recruits),
    clicks: n(r.clicks),
    conversions: n(r.conversions),
    grossMinor: n(r.gross_minor),
    reversedMinor: n(r.reversed_minor),
    paidOutMinor: n(r.paid_out_minor),
    balanceMinor: n(r.balance_minor),
    pendingMinor: n(r.pending_minor),
    joinedAt: String(r.joined_at),
  }))
}

/**
 * The four figures at the top of the screen, over a window.
 *
 * `owed` is the one that matters operationally — cleared commission nobody has
 * been paid yet — so it is deliberately NOT derived in the UI from the other
 * three, which would let a rounding difference make the summary disagree with
 * itself.
 */
export async function getCommissionTotals(days = 30): Promise<CommissionTotals> {
  const supabase = createAdminClient()

  const from = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await supabase.rpc('admin_commission_totals', { p_from: from })
  if (error) throw new Error(`Could not load commission totals: ${error.message}`)

  /* The function `returns table`, so PostgREST hands back an array of one. */
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined

  return {
    pendingMinor: n(row?.pending_minor),
    clearedMinor: n(row?.cleared_minor),
    reversedMinor: n(row?.reversed_minor),
    paidMinor: n(row?.paid_minor),
    owedMinor: n(row?.owed_minor),
    affiliatesOwed: n(row?.affiliates_owed),
  }
}

/**
 * How many commission withdrawals are waiting on somebody, for the nav badge.
 *
 * A count query rather than `getCommissionPayouts().length`, because the admin
 * layout runs this on every page load including the ones that never mention an
 * affiliate.
 */
export async function countCommissionPayoutsAwaitingDecision(): Promise<number> {
  const supabase = createAdminClient()

  const { count, error } = await supabase
    .from('commission_payouts')
    .select('id', { count: 'exact', head: true })
    .in('status', ['requested', 'approved'])

  return error ? 0 : (count ?? 0)
}
