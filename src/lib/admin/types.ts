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
  user: {
    name: string
    email: string
    avatarUrl: string | null
    joinedAt: string
    /** How many payouts this person has already been paid, and for how much. */
    paidBefore: number
    paidBeforeGhs: number
  }
  points: number
  ghs: number
  method: 'mobile_money' | 'crypto'
  /** MTN, Telecel, AirtelTigo, or the chain: "USDT · TRC-20". */
  provider: string
  /**
   * The destination IN FULL — the phone number or wallet address.
   *
   * Stored whole and masked at the point of render by `maskDestination`,
   * never pre-masked into a display string. Masking in the data means the
   * value cannot be revealed when somebody legitimately needs it, cannot be
   * compared for reuse, and cannot be copied to actually send the money —
   * so the mask belongs in the view and the rule belongs in one function.
   */
  destination: string
  /** The name registered on that MoMo account / labelled on that wallet. */
  accountName: string
  /**
   * How many OTHER users have requested a payout to this same destination.
   * 0 is the normal case. Anything above it is the single cheapest fraud
   * signal a watch-to-earn platform has, so it is on the request itself
   * rather than something the operator has to go and search for.
   */
  reuse: number
  status: PayoutStatus
  requestedAt: string
  /** When the status last moved. The 48-hour dispute window runs from here. */
  statusChangedAt: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  /** Why the risk is what it is. Empty on a clean request. */
  riskReasons?: string[]
  /**
   * The note the operator gave when they last held, declined or disputed it.
   * The user is shown this verbatim in their notifications, which is why it
   * is required for those three actions and stored on the request rather
   * than only in the audit log — the next operator to open this needs to see
   * what the last one told them.
   */
  decisionNote?: string
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
