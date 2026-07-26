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

/* ---- The ad pool. Real data, not preview — see lib/admin/ads-data.ts ---- */

/** Mirrors public.ad_status exactly. `exhausted` is set by the database when
 *  an ad delivers its budget; no operator ever picks it. */
export type AdStatus = 'draft' | 'active' | 'paused' | 'exhausted' | 'archived'
export type AdFormat = 'video' | 'survey'
export type VideoSource = 'upload' | 'youtube'
export type AnswerFormat = 'multiple_choice' | 'short_text'
export type ConditionMode = 'all' | 'any'

/** The statuses an operator may choose. Draft is where an ad starts. */
export const CHOOSABLE_STATUSES: AdStatus[] = ['draft', 'active', 'paused', 'archived']

/**
 * One item in the pool users watch and answer.
 *
 * `completions` against `budget` is the number that decides whether an ad is
 * about to stop serving, so the two travel together rather than being looked
 * up separately. `tiers` empty means everyone — inclusive by default, which
 * is the rule the database already enforces (upgrading never shrinks a
 * user's pool).
 *
 * `attempts` is here for one reason: it decides which verb the row may offer.
 * An ad nobody has attempted can be deleted outright; after that the attempt
 * history is the evidence behind completions people were paid for, so the
 * only honest action is archive.
 */
export type AdListItem = {
  id: string
  title: string
  description: string | null
  advertiser: string | null
  format: AdFormat
  status: AdStatus
  /** Points a Free-tier user earns. Higher plans multiply this. */
  points: number
  /** Completions paid for (null = unlimited) against completions delivered. */
  budget: number | null
  completions: number
  attempts: number
  questionCount: number
  /** How many questions have an answer key. The rest are opinion questions. */
  gradedCount: number
  /** Branching rules across the whole ad. 0 = every respondent sees the same
   *  questions. */
  branchingCount: number
  /** Questions pinned to a second of the video rather than asked at the end. */
  cueCount: number
  /** Plan names this is limited to. Empty = the whole platform. */
  tiers: string[]
  videoSource: VideoSource | null
  durationSeconds: number | null
  minWatchSeconds: number | null
  thumbnailUrl: string | null
  weight: number
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
}

/** A plan, as the audience picker needs it. */
export type TierOption = { id: string; name: string; slug: string; isDefault: boolean }

/* ---- The editor's working copy -------------------------------------------
 *
 * Everything inside a draft is addressed by a LOCAL key, never by an index or
 * a database id. Indexes are what admin_save_ad wants and what admin_get_ad
 * returns, but they shift the moment a question is reordered or an option is
 * removed — and a branching rule that quietly re-points at a different
 * question because a row moved is the worst bug this screen could have. Keys
 * survive both, and adDraftPayload() converts them back to indexes once, at
 * the point of saving.
 */

export type AdOptionDraft = { key: string; text: string; correct: boolean }

export type AdRuleDraft = {
  key: string
  /** Local key of the EARLIER question whose answer is tested. */
  dependsOn: string
  /** Local key of the option that must have been chosen. */
  optionKey: string | null
  /** For a typed answer: compared case-insensitively and trimmed. */
  valueText: string | null
  /** "is not" rather than "is". */
  negate: boolean
}

export type AdQuestionDraft = {
  key: string
  text: string
  format: AnswerFormat
  /** Short-text answer key. Null means opinion: any answer is accepted. */
  correctAnswer: string | null
  /** Second of the video this interrupts at. Null = ask at the end. */
  showAtSeconds: number | null
  conditionMode: ConditionMode
  options: AdOptionDraft[]
  rules: AdRuleDraft[]
}

export type AdDraft = {
  /** Null while creating. */
  id: string | null
  title: string
  description: string
  advertiser: string
  format: AdFormat
  status: AdStatus
  points: number
  videoSource: VideoSource | null
  storagePath: string | null
  youtubeId: string | null
  thumbnailPath: string | null
  durationSeconds: number | null
  minWatchSeconds: number | null
  maxCompletions: number | null
  weight: number
  /** ISO strings, or null for "no boundary". */
  startsAt: string | null
  endsAt: string | null
  /** Empty = everyone. */
  tierIds: string[]
  questions: AdQuestionDraft[]

  /* Read-only context, carried so the form can explain itself. */
  completions: number
  attempts: number
  /**
   * True once somebody has completed this ad. The database refuses question
   * edits from then on — rewriting the questions under people who already
   * answered rewrites the advertiser's research — so the editor says so
   * rather than accepting edits the save will silently drop.
   */
  questionsLocked: boolean
}

/**
 * A plan, as `public.tiers` actually stores it, plus how it is selling.
 *
 * The field names follow the columns rather than the marketing, because the
 * admin editing this needs to know which column they are changing — and
 * because the database's own check constraints are the validation rules the
 * form has to mirror.
 */
export type PlanRow = {
  id: string
  /** Machine identifier. Immutable once created: subscriptions, payments and
   *  the seed all refer to a plan by slug. */
  slug: string
  name: string
  description: string
  priceGhs: number
  billingPeriodDays: number
  /** Ads per day this plan allows IN TOTAL, free allowance included. */
  dailyAdCap: number
  /** Multiplies the points on every ad. 1 = the base rate. */
  rewardMultiplier: number
  redemptionMinimumPoints: number
  referralBonusMultiplier: number
  adPriority: number
  adCooldownSeconds: number
  /** The tier every new user starts on. Exactly one plan has it, it must be
   *  free, and it cannot be hidden — all three enforced in the database. */
  isDefault: boolean
  status: 'live' | 'hidden'
  sortOrder: number
  /** Sales, not configuration. */
  active: number
  activeLastMonth: number
  monthlyGhs: number
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
