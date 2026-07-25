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
  /**
   * What the account has actually done. The balance alone cannot tell an
   * operator whether somebody is a real user or a farm — 90,000 points earned
   * over five months reads very differently from the same 90,000 in nine
   * days, and the flag review is the screen where that difference decides
   * whether money leaves.
   */
  lifetimePoints: number
  adsWatched: number
  referrals: number
  lastActiveAt: string
  /** How much has already been paid out to them, in cedis. */
  paidOutGhs: number
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

/* ------------------------------------------------------------------ */
/* Content, money and system records                                   */
/* ------------------------------------------------------------------ */

/**
 * One item in the pool users watch and answer.
 *
 * `completions` against `budget` is the number that decides whether an ad is
 * about to stop serving, so the two travel together rather than being looked
 * up separately. `tiers` empty means everyone — inclusive by default, which
 * is the rule the database already enforces (upgrading never shrinks a
 * user's pool).
 */
export type AdItem = {
  id: string
  title: string
  advertiser: string
  format: 'video' | 'survey'
  status: 'live' | 'paused' | 'draft' | 'archived'
  /** Points a Free-tier user earns. Higher plans multiply this. */
  points: number
  durationSeconds: number
  questions: number
  /** How many completions are paid for, and how many have happened. */
  budget: number
  completions: number
  /** Plan names this is limited to. Empty = the whole platform. */
  tiers: string[]
  createdAt: string
}

/** A plan, and how it is actually selling. */
export type PlanRow = {
  id: string
  name: string
  priceGhs: number
  /** What a subscriber gets, as the operator words it. */
  multiplier: number
  dailyAdsBonus: number
  active: number
  /** Active subscribers a month ago, for the trend. */
  activeLastMonth: number
  monthlyGhs: number
  status: 'live' | 'hidden'
}

/** An advertiser contract, keyed in by hand until self-serve exists. */
export type Advertiser = {
  id: string
  name: string
  contact: string
  status: 'active' | 'ended' | 'pending'
  /** What they have paid, and what has been delivered against it. */
  contractGhs: number
  spentGhs: number
  adsLive: number
  startedAt: string
  endsAt: string | null
}

/** One line of the admin audit log. */
export type AuditEntry = {
  id: string
  at: string
  actor: string
  /** Machine name of what happened — drives the label and the colour. */
  action:
    | 'payout_approved'
    | 'payout_declined'
    | 'payout_paid'
    | 'account_flagged'
    | 'account_disabled'
    | 'config_changed'
    | 'ad_created'
    | 'ad_paused'
    | 'alert_raised'
  /** What it happened to, in the operator's words. */
  target: string
  /** Only on config changes, and only when there genuinely was a before. */
  before?: string
  after?: string
  note?: string
}

/** One row of the money statement. */
export type FinanceRow = {
  month: string
  subscriptionsGhs: number
  advertisersGhs: number
  withdrawalsGhs: number
}
