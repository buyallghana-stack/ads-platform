/**
 * Shared admin types and the pure rules that go with them.
 *
 * Split out of preview.ts because that module is `server-only` and these are
 * needed on BOTH sides: the payouts table and the people grid are client
 * components. Importing a server-only module from a client component is a
 * build error, and rightly so — this file exists to make the boundary
 * explicit rather than to work around it.
 *
 * Nothing here reads data. Types, constants, and functions of their
 * arguments only.
 */

export type Trend = { value: number; changePct: number }

export type OverviewMetrics = {
  /** Everything that came IN: plan purchases plus advertiser contracts. */
  deposits: Trend & { subscriptions: number; advertisers: number }
  /** Everything paid OUT to users. */
  withdrawals: Trend
  /** deposits − withdrawals. The operator's headline number. */
  profit: Trend
  /**
   * Points people hold but have not cashed out, valued at the current rate.
   * Not profit and not a cost yet — it is what the platform owes if everybody
   * redeemed tomorrow, and the number that decides whether the float is
   * healthy. Worth showing beside profit so profit is never read alone.
   */
  liability: { points: number; ghs: number }
  users: Trend & { newToday: number }
  subscriptions: Trend & { active: number }
  pendingPayouts: { count: number; ghs: number }
  adsLive: { total: number; videos: number; surveys: number }
}

/** One bar per day: money in against money out. */
export type DailyMoney = { day: string; deposits: number; withdrawals: number }

/**
 * Mirrors public.redemption_status, plus `disputed`.
 *
 * `disputed` does not exist in the database yet — it arrives with the backend
 * work. It is here because the operator's rule shapes the UI: after a payout
 * is marked paid they may raise a dispute, but only within 48 hours of that
 * status change, and if they take no action the option disappears.
 */
export type PayoutStatus =
  | 'held'
  | 'pending_approval'
  | 'approved'
  | 'paid'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  | 'disputed'

export type PayoutRequest = {
  id: string
  reference: string
  user: { name: string; email: string; avatarUrl: string | null }
  points: number
  ghs: number
  method: 'mobile_money' | 'crypto'
  destination: string
  status: PayoutStatus
  requestedAt: string
  /** When the status last moved. The 48-hour dispute window runs from here. */
  statusChangedAt: string
  risk: 'low' | 'medium' | 'high' | 'critical'
}

export type Person = {
  id: string
  name: string
  email: string
  phone: string | null
  avatarUrl: string | null
  joinedAt: string
  balancePoints: number
  tier: string
  status: 'active' | 'flagged' | 'disabled'
  /** Set on flagged accounts: who raised it and why. */
  flaggedBy?: 'system' | 'admin'
  flagReason?: string
  /** Message thread state, for the Messages tab. */
  unread?: number
  lastMessageAt?: string
  lastMessage?: string
}

/**
 * The operator's rule, in one place so the table and any future server action
 * cannot disagree: a dispute may be raised only on a payout already marked
 * paid, and only within 48 hours of that status change. After that the option
 * disappears rather than sitting there greyed out — an action that can never
 * succeed should not keep occupying the row.
 *
 * `now` is a parameter rather than a call to Date.now() so the caller decides
 * the clock. That is what lets the server and the first client render agree.
 */
export const DISPUTE_WINDOW_HOURS = 48

export function canDispute(request: PayoutRequest, now: number): boolean {
  if (request.status !== 'paid') return false
  const elapsed = now - new Date(request.statusChangedAt).getTime()
  return elapsed < DISPUTE_WINDOW_HOURS * 3_600_000
}
