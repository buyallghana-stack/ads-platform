import type { CtaLink } from '@/lib/ads/cta'

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

/**
 * A figure and how it moved against the previous window.
 *
 * `changePct` is NULL when the earlier window was empty — going from nothing
 * to GHS 740 is neither "+100%" nor "no change", it is a comparison that
 * cannot be made. The card renders no trend at all in that case, which is the
 * only honest thing to draw and matters most in a platform's first weeks,
 * when almost every comparison is against zero.
 */
export type Trend = { value: number; changePct: number | null }

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
  adsLive: { total: number; videos: number; surveys: number; links: number }
}

/** One bar per day: money in against money out. */
export type DailyMoney = { day: string; deposits: number; withdrawals: number }

/**
 * Mirrors public.redemption_status.
 *
 * `disputed` is deliberately ABSENT. The operator removed disputes on
 * 2026-07-29 — a payout can be held at any point before the money leaves, the
 * user is told it is on hold and why, and the chatbot carries it from there,
 * which is reversible where a dispute never was. The enum label still exists
 * in Postgres because a value cannot be dropped from a type without rebuilding
 * it, but a check constraint makes it unreachable, so no row can arrive here
 * carrying it. See migration 057.
 */
export type PayoutStatus =
  | 'held'
  | 'pending_approval'
  | 'approved'
  | 'paid'
  | 'rejected'
  | 'cancelled'
  | 'failed'

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
  /** Always present. Cedis stay authoritative for accounting and for any
   *  total, because the point is pegged to the cedi and two currencies do not
   *  add up. What a HUMAN is shown for a crypto request is the coin. */
  ghs: number
  /** The fee rate frozen onto this request when it was filed. */
  feePercent: number
  /** What that rate took, in cedis. */
  feeGhs: number
  /** ghs − feeGhs: what the user is owed and what the operator sends. */
  netGhs: number
  /** Crypto only: the ticker the user is paid in, "USDT" or "USDC". */
  coin?: string
  /** Crypto only: the amount frozen when the request was made — what the user
   *  was quoted, and what the operator should send. */
  coinAmount?: number
  /** Crypto only, and only when nothing was frozen because no fresh rate
   *  existed at request time. Today's rate, never to be presented as the
   *  amount the user was promised. */
  liveCoinAmount?: number
  /** When `coinAmount` was taken. Absent means it was never frozen. */
  quotedAt?: string
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
  /** When the status last moved. */
  statusChangedAt: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  /** Why the risk is what it is. Empty on a clean request. */
  riskReasons?: string[]
  /**
   * The note the operator gave when they last held or declined it.
   * The user is shown this verbatim in their notifications, which is why it
   * is required for those three actions and stored on the request rather
   * than only in the audit log — the next operator to open this needs to see
   * what the last one told them.
   */
  decisionNote?: string
  /**
   * When the fraud-catch window on this request ends.
   *
   * FROZEN AT REQUEST TIME, and that is the whole point: it is computed from
   * `redemption_holding_hours` when the request is filed and stored on the
   * row, so lowering that setting afterwards does NOT release requests that
   * are already waiting. A window somebody can shorten retroactively is not
   * a fraud-catch window.
   *
   * `'infinity'` here means an operator placed the hold themselves and only
   * an operator can lift it.
   */
  holdingUntil?: string
  /** Set when the hold was placed by a person rather than by the fraud window. */
  adminHeld?: boolean
  /** True when this was approved before its window elapsed, under override. */
  approvedEarly?: boolean
}

/**
 * Does approving this request need the early-approval override?
 *
 * MIRRORS `approve_redemption` EXACTLY: it demands the override for any row
 * whose status is `held`, full stop — whether the hold came from the fraud
 * window or from an operator. Re-deriving that from dates here is how the
 * button ends up offering something the database refuses; the maturity of the
 * window only decides what we SAY, never whether the override is needed.
 */
export function needsEarlyApproval(request: PayoutRequest): boolean {
  return request.status === 'held'
}

/**
 * When the hold ends, in words the panel can print — or null when there is no
 * date to give.
 *
 * `holding_until` is `'infinity'` for an operator-placed hold, which
 * `new Date()` parses as NaN rather than Infinity. That is not "no hold", it
 * is "until a person lifts it", so it must not fall through to a date.
 */
export function holdEndsAt(request: PayoutRequest): Date | null {
  if (!request.holdingUntil || request.adminHeld) return null
  const at = new Date(request.holdingUntil)
  return Number.isNaN(at.getTime()) ? null : at
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
  /**
   * What this account actually earns at, and what it is paying.
   *
   * The plan's NAME stopped being the whole answer when plans became bands:
   * two people on Gold who paid GHS 250 and GHS 480 earn at ×2.50 and ×2.92.
   * The multiplier here is the resolved one — interpolation and stacking
   * already applied — so it is the figure the ad path actually pays by.
   */
  tierMultiplier: number
  /** Total currently being paid across every live plan, in cedis. 0 on Free. */
  tierPaidGhs: number
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

/* ------------------------------------------------------------------ */
/* Content, money and system records                                   */
/* ------------------------------------------------------------------ */

/* ---- The ad pool. Real data, not preview — see lib/admin/ads-data.ts ---- */

/** Mirrors public.ad_status exactly. `exhausted` is set by the database when
 *  an ad delivers its budget; no operator ever picks it. */
export type AdStatus = 'draft' | 'active' | 'paused' | 'exhausted' | 'archived'
/**
 * Mirrors public.ad_format. `link` since 2026-07-31: an article the user
 * reads, ending in one link out to the advertiser — the click is what pays.
 */
export type AdFormat = 'video' | 'survey' | 'link'
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

  /**
   * The advertiser's call to action. Video ads only — the database refuses it
   * on a survey, because pushing a respondent to a shop mid-questionnaire
   * changes what their answers mean.
   */
  ctaLabel: string
  ctaLinks: CtaLink[]

  /**
   * The piece a LINK ad asks the reader to read, before the link that pays.
   * Empty on every other format — a video says what it has to say in the
   * video, and a survey asks rather than tells.
   */
  articleBody: string

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
  /** The FLOOR of the band, not a fixed price. Since migration 098 a buyer
   *  chooses what to pay from here up to `bandMaxGhs`, and what they choose
   *  decides what an ad is worth to them. */
  priceGhs: number
  /** The top of the band, as the database computes it (`plan_band_max_minor`)
   *  — one pesewa under the next plan's floor, or the top plan's own ceiling,
   *  or its price when it has neither. Null for the free plan and any hidden
   *  plan: neither is sold, so neither has a band. */
  bandMaxGhs: number | null
  /**
   * The top rung's OWN ceiling and the rate reached there — the two numbers
   * the plan above would otherwise supply.
   *
   * Null on every plan that has one above it, where the ladder answers both
   * questions and a stored ceiling would be ignored. Distinct from
   * `bandMaxGhs`, which is derived and always has a value: this is what is
   * actually stored, and it is what the editor must show, because offering to
   * "save" a derived number would give a plan a ceiling it never had.
   */
  ownBandMaxGhs: number | null
  ownBandMaxMultiplier: number | null
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
  /** What buyers chose inside the band, over the same thirty days as the
   *  revenue. `paidAboveFloor` is the number that says whether letting people
   *  pick their own amount is earning its keep; `paidAvgGhs` is null when
   *  nobody has bought, because "no average" and "paid nothing" differ. */
  paidCount: number
  paidAboveFloor: number
  paidAvgGhs: number | null
}

/** An advertiser contract, keyed in by hand until self-serve exists. */
export type Advertiser = {
  id: string
  name: string
  contact: string | null
  status: 'active' | 'ended' | 'pending'
  /**
   * What they have paid, and what has been delivered against it.
   *
   * `contractGhs` is the SUM OF THEIR RECEIPTS, not a stored contract value —
   * a single editable "contract worth" column would have to be rewritten
   * every time more money arrived, and an edited number cannot answer "when
   * did they pay, how much, and against what bank reference?".
   *
   * `spentGhs` comes from the points ledger rather than from completion
   * counts, because the reward is tier-adjusted at credit time: what an ad
   * actually cost is what was actually credited for it.
   */
  contractGhs: number
  spentGhs: number
  adsLive: number
  /** Including paused, finished and archived ones. */
  adsTotal: number
  /** How many receipts make up `contractGhs`, and when the last one landed. */
  payments: number
  lastPaidAt: string | null
  startedAt: string
  endsAt: string | null
  notes: string | null
}

/** One receipt against an advertiser, as shown in their review panel. */
export type AdvertiserPayment = {
  id: string
  amountGhs: number
  receivedAt: string
  method: string | null
  reference: string | null
  note: string | null
  recordedBy: string | null
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
