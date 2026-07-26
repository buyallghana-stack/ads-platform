import 'server-only'

import type {
  Advertiser,
  AuditEntry,
  DailyMoney,
  FinanceRow,
  OverviewMetrics,
  PayoutRequest,
  Person,
  PlanRow,
} from './types'

/**
 * PREVIEW DATA FOR THE ADMIN DASHBOARD — nothing here is real.
 *
 * The operator asked for the admin UI first and the backend after, so every
 * screen renders from this module and nothing else. That is a deliberate
 * seam, not a shortcut: each function below returns the exact shape the real
 * query has to return, so wiring a screen later is replacing one function
 * body, not rewriting a component.
 *
 * Two rules while this exists:
 *   1. Every admin screen shows the "Preview data" badge in the top bar. An
 *      operator must never be able to mistake an invented number for a real
 *      one — these are money figures.
 *   2. Nothing here writes anything. The action buttons are wired to local
 *      state only.
 *
 * Figures are chosen to be plausible for a Ghana-market platform a few months
 * in, so the layout is exercised at realistic magnitudes rather than at 0 or
 * at numbers that break the column widths.
 */

export const PREVIEW = true

const HOURS = 3_600_000

export function overviewMetrics(): OverviewMetrics {
  return {
    deposits: { value: 48250, changePct: 18.4, subscriptions: 21750, advertisers: 26500 },
    withdrawals: { value: 19430, changePct: 12.1 },
    profit: { value: 28820, changePct: 23.6 },
    liability: { points: 4_182_000, ghs: 4182 },
    users: { value: 2841, changePct: 9.2, newToday: 37 },
    subscriptions: { value: 418, changePct: 6.8, active: 418 },
    pendingPayouts: { count: 12, ghs: 2340 },
    adsLive: { total: 7, videos: 4, surveys: 3 },
  }
}

export function moneySeries(days = 30): DailyMoney[] {
  const out: DailyMoney[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000)
    // Deterministic wobble so the chart is stable between renders and does
    // not shimmer on every refresh while it is preview data.
    const wave = Math.sin(i / 3.1) + Math.sin(i / 6.7)
    out.push({
      day: date.toISOString().slice(0, 10),
      deposits: Math.round(1200 + wave * 260 + (i % 5) * 90),
      withdrawals: Math.round(520 + Math.cos(i / 4.3) * 180 + (i % 3) * 60),
    })
  }
  return out
}

export function payoutRequests(): PayoutRequest[] {
  const now = Date.now()
  const at = (h: number) => new Date(now - h * HOURS).toISOString()
  const days = (d: number) => new Date(now - d * 24 * HOURS).toISOString()

  /* Destinations are stored WHOLE here, exactly as the real column will hold
     them, and masked at render by maskDestination(). Storing them pre-masked
     would have made the mask untestable and the reveal impossible. */
  return [
    {
      id: 'r1', reference: 'RDM-4821',
      user: {
        name: 'Ama Boateng', email: 'ama.boateng@gmail.com', avatarUrl: null,
        joinedAt: days(96), paidBefore: 4, paidBeforeGhs: 61,
      },
      points: 8500, ghs: 8.5,
      method: 'mobile_money', provider: 'MTN MoMo',
      destination: '0244567891', accountName: 'Ama Boateng',
      reuse: 0,
      status: 'pending_approval', requestedAt: at(5), statusChangedAt: at(5),
      risk: 'low',
    },
    {
      // The one that should stop an operator: big, crypto, brand-new account,
      // and the wallet has already been used by somebody else.
      id: 'r2', reference: 'RDM-4820',
      user: {
        name: 'Kwabena Mensah', email: 'k.mensah@gmail.com', avatarUrl: null,
        joinedAt: days(6), paidBefore: 0, paidBeforeGhs: 0,
      },
      points: 42000, ghs: 42,
      method: 'crypto', provider: 'USDT · TRC-20',
      destination: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', accountName: 'K. Mensah',
      reuse: 2,
      status: 'pending_approval', requestedAt: at(9), statusChangedAt: at(9),
      risk: 'high',
      riskReasons: [
        'Wallet already used by 2 other accounts',
        'Account is 6 days old',
        'First payout, and 4.9× this user\u2019s average daily earning',
      ],
    },
    {
      id: 'r3', reference: 'RDM-4816',
      user: {
        name: 'Efua Sarpong', email: 'efua.s@gmail.com', avatarUrl: null,
        joinedAt: days(41), paidBefore: 2, paidBeforeGhs: 27,
      },
      points: 12000, ghs: 12,
      method: 'mobile_money', provider: 'Telecel Cash',
      destination: '0201180043', accountName: 'Efua Sarpong Mensimah',
      reuse: 0,
      status: 'held', requestedAt: at(26), statusChangedAt: at(26),
      risk: 'medium',
      riskReasons: ['Payout account changed 2 days ago'],
    },
    {
      id: 'r4', reference: 'RDM-4809',
      user: {
        name: 'Yaw Antwi', email: 'yaw.antwi@gmail.com', avatarUrl: null,
        joinedAt: days(150), paidBefore: 9, paidBeforeGhs: 214,
      },
      points: 30000, ghs: 30,
      method: 'mobile_money', provider: 'MTN MoMo',
      destination: '0249032117', accountName: 'Yaw Antwi',
      reuse: 0,
      status: 'approved', requestedAt: at(40), statusChangedAt: at(11),
      risk: 'low',
    },
    {
      // Paid 6 hours ago — inside the 48-hour window, so a dispute is offered.
      id: 'r5', reference: 'RDM-4802',
      user: {
        name: 'Adwoa Nyarko', email: 'adwoa.n@gmail.com', avatarUrl: null,
        joinedAt: days(88), paidBefore: 6, paidBeforeGhs: 133,
      },
      points: 25000, ghs: 25,
      method: 'mobile_money', provider: 'AirtelTigo Money',
      destination: '0267741905', accountName: 'Adwoa Nyarko',
      reuse: 0,
      status: 'paid', requestedAt: at(70), statusChangedAt: at(6),
      risk: 'low',
    },
    {
      // Paid 3 days ago — window closed, so no dispute action is shown.
      id: 'r6', reference: 'RDM-4788',
      user: {
        name: 'Kojo Asare', email: 'kojo.asare@gmail.com', avatarUrl: null,
        joinedAt: days(210), paidBefore: 14, paidBeforeGhs: 402,
      },
      points: 15000, ghs: 15,
      method: 'crypto', provider: 'USDT · TRC-20',
      destination: 'TQm3xBv7YHsWpEc2gKfN9dRa4LuZ7pLk2w', accountName: 'Kojo Asare',
      reuse: 0,
      status: 'paid', requestedAt: at(96), statusChangedAt: at(74),
      risk: 'low',
    },
    {
      id: 'r7', reference: 'RDM-4771',
      user: {
        name: 'Abena Owusu', email: 'abena.owusu@gmail.com', avatarUrl: null,
        joinedAt: days(19), paidBefore: 1, paidBeforeGhs: 12,
      },
      points: 60000, ghs: 60,
      method: 'crypto', provider: 'USDT · TRC-20',
      destination: 'TXk9pWqLm4CzVb8NdRt6HyU2sFa3nVc8s1', accountName: 'A. O.',
      reuse: 3,
      status: 'disputed', requestedAt: at(140), statusChangedAt: at(20),
      risk: 'critical',
      riskReasons: [
        'Wallet already used by 3 other accounts',
        'Name on wallet does not match the profile',
        'Device shared with 4 flagged accounts',
      ],
    },
    {
      id: 'r8', reference: 'RDM-4760',
      user: {
        name: 'Kofi Danso', email: 'kofi.danso@gmail.com', avatarUrl: null,
        joinedAt: days(12), paidBefore: 0, paidBeforeGhs: 0,
      },
      points: 9000, ghs: 9,
      method: 'mobile_money', provider: 'MTN MoMo',
      destination: '0592214760', accountName: 'Mavis Danso',
      reuse: 1,
      status: 'rejected', requestedAt: at(190), statusChangedAt: at(160),
      risk: 'high',
      riskReasons: ['Name on the MoMo account does not match the profile'],
    },
  ]
}

export function people(): Person[] {
  const now = Date.now()
  const at = (h: number) => new Date(now - h * HOURS).toISOString()

  /*
    Activity is DERIVED from the balance and the join date rather than typed
    out per person, so the numbers stay internally consistent: a flagged
    account that earned 46,800 points in thirteen days looks wrong here for
    the same arithmetic reason it would look wrong in production, instead of
    because somebody hand-picked a scary figure. Points-per-ad is the seeded
    average; referrals hash off the id so they are stable between renders.
  */
  const withActivity = (p: Omit<Person, 'lifetimePoints' | 'adsWatched' | 'referrals' | 'lastActiveAt' | 'paidOutGhs'>): Person => {
    const paidOutPoints = Math.round(p.balancePoints * 0.6)
    const lifetimePoints = p.balancePoints + paidOutPoints
    const hash = [...p.id].reduce((n, c) => n + c.charCodeAt(0), 0)
    return {
      ...p,
      lifetimePoints,
      adsWatched: Math.round(lifetimePoints / 55),
      referrals: hash % 7,
      lastActiveAt: at((hash % 40) + 1),
      paidOutGhs: Math.round(paidOutPoints / 1000),
    }
  }

  return ([
    { id: 'u1', name: 'Ama Boateng', email: 'ama.boateng@gmail.com', phone: '024 123 4567',
      avatarUrl: null, joinedAt: at(600), balancePoints: 12400, tier: 'Gold', status: 'active',
      unread: 2, lastMessageAt: at(1), lastMessage: 'My withdrawal has been pending for two days…' },
    { id: 'u2', name: 'Kwabena Mensah', email: 'k.mensah@gmail.com', phone: '020 887 3019',
      avatarUrl: null, joinedAt: at(320), balancePoints: 46800, tier: 'Platinum', status: 'flagged',
      flaggedBy: 'system', flagReason: 'Six accounts share this device fingerprint',
      unread: 1, lastMessageAt: at(4), lastMessage: 'Why can I not withdraw?' },
    { id: 'u3', name: 'Efua Sarpong', email: 'efua.s@gmail.com', phone: '054 332 9090',
      avatarUrl: null, joinedAt: at(1500), balancePoints: 3100, tier: 'Free', status: 'active',
      lastMessageAt: at(30), lastMessage: 'Thank you, it worked.' },
    { id: 'u4', name: 'Yaw Antwi', email: 'yaw.antwi@gmail.com', phone: '024 111 3290',
      avatarUrl: null, joinedAt: at(90), balancePoints: 800, tier: 'Bronze', status: 'active' },
    { id: 'u5', name: 'Adwoa Nyarko', email: 'adwoa.n@gmail.com', phone: '027 481 2332',
      avatarUrl: null, joinedAt: at(2200), balancePoints: 22050, tier: 'Silver', status: 'active',
      unread: 3, lastMessageAt: at(2), lastMessage: 'I was charged twice for Gold.' },
    { id: 'u6', name: 'Kojo Asare', email: 'kojo.asare@gmail.com', phone: '050 321 2020',
      avatarUrl: null, joinedAt: at(48), balancePoints: 150, tier: 'Free', status: 'active' },
    { id: 'u7', name: 'Abena Owusu', email: 'abena.owusu@gmail.com', phone: '026 222 2345',
      avatarUrl: null, joinedAt: at(700), balancePoints: 91500, tier: 'Platinum', status: 'flagged',
      flaggedBy: 'admin', flagReason: 'Payout disputed after completion',
      unread: 5, lastMessageAt: at(1), lastMessage: 'This is unfair, I earned those points.' },
    { id: 'u8', name: 'Kofi Danso', email: 'kofi.danso@gmail.com', phone: '024 999 7676',
      avatarUrl: null, joinedAt: at(410), balancePoints: 0, tier: 'Free', status: 'disabled',
      flaggedBy: 'admin', flagReason: 'Repeated failed attention questions' },
    { id: 'u9', name: 'Akosua Frimpong', email: 'akosua.f@gmail.com', phone: '055 321 9087',
      avatarUrl: null, joinedAt: at(20), balancePoints: 340, tier: 'Free', status: 'active' },
    { id: 'u10', name: 'Nana Addo Baah', email: 'nana.baah@gmail.com', phone: '023 332 1020',
      avatarUrl: null, joinedAt: at(1100), balancePoints: 18200, tier: 'Gold', status: 'active' },
    { id: 'u11', name: 'Esi Quartey', email: 'esi.quartey@gmail.com', phone: '024 909 2901',
      avatarUrl: null, joinedAt: at(260), balancePoints: 7600, tier: 'Bronze', status: 'active',
      unread: 1, lastMessageAt: at(9), lastMessage: 'How long does a payout take?' },
    { id: 'u12', name: 'Selorm Agbeko', email: 'selorm.a@gmail.com', phone: '020 231 9091',
      avatarUrl: null, joinedAt: at(3000), balancePoints: 55400, tier: 'Platinum', status: 'active' },
  ] as const).map(withActivity)
}

/* ------------------------------------------------------------------ */
/* Content, money and system records                                   */
/* ------------------------------------------------------------------ */

/**
 * The plans, exactly as `public.tiers` holds them after migration 037.
 *
 * The numbers are the real seeded ones rather than invented, because this is
 * the screen where the value-per-cedi line is checked — plausible-looking
 * figures that were not actually on the line would make the editor's warning
 * fire on load and teach the operator to ignore it.
 *
 *   free allowance 20 ads/day; every GHS 1 buys +0.5 ads and +0.5% rate
 */
export function plans(): PlanRow[] {
  return [
    {
      id: 'p0', slug: 'free', name: 'Free',
      description: 'Where everybody starts.',
      priceGhs: 0, billingPeriodDays: 30,
      dailyAdCap: 20, rewardMultiplier: 1, redemptionMinimumPoints: 5000,
      referralBonusMultiplier: 1, adPriority: 0, adCooldownSeconds: 0,
      isDefault: true, status: 'live', sortOrder: 0,
      active: 2423, activeLastMonth: 2260, monthlyGhs: 0,
    },
    {
      id: 'p1', slug: 'bronze', name: 'Bronze',
      description: 'A gentle lift on your daily limit, for casual watching.',
      priceGhs: 20, billingPeriodDays: 90,
      dailyAdCap: 30, rewardMultiplier: 1.1, redemptionMinimumPoints: 4000,
      referralBonusMultiplier: 1.1, adPriority: 1, adCooldownSeconds: 0,
      isDefault: false, status: 'live', sortOrder: 1,
      active: 186, activeLastMonth: 171, monthlyGhs: 3720,
    },
    {
      id: 'p2', slug: 'silver', name: 'Silver',
      description: 'More ads a day and a better rate, for regular earners.',
      priceGhs: 50, billingPeriodDays: 90,
      dailyAdCap: 45, rewardMultiplier: 1.25, redemptionMinimumPoints: 3000,
      referralBonusMultiplier: 1.25, adPriority: 2, adCooldownSeconds: 0,
      isDefault: false, status: 'live', sortOrder: 2,
      active: 124, activeLastMonth: 118, monthlyGhs: 6200,
    },
    {
      id: 'p3', slug: 'gold', name: 'Gold',
      description: 'A high daily limit, priority ads and a low payout threshold.',
      priceGhs: 100, billingPeriodDays: 90,
      dailyAdCap: 70, rewardMultiplier: 1.5, redemptionMinimumPoints: 2000,
      referralBonusMultiplier: 1.5, adPriority: 3, adCooldownSeconds: 0,
      isDefault: false, status: 'live', sortOrder: 3,
      active: 78, activeLastMonth: 66, monthlyGhs: 7800,
    },
    {
      id: 'p4', slug: 'platinum', name: 'Platinum',
      description: 'The highest limit and the best rate we offer.',
      priceGhs: 200, billingPeriodDays: 90,
      dailyAdCap: 120, rewardMultiplier: 2, redemptionMinimumPoints: 1000,
      referralBonusMultiplier: 2, adPriority: 4, adCooldownSeconds: 0,
      isDefault: false, status: 'live', sortOrder: 4,
      active: 30, activeLastMonth: 21, monthlyGhs: 6000,
    },
  ]
}

export function advertisers(): Advertiser[] {
  const now = Date.now()
  const days = (d: number) => new Date(now - d * 24 * HOURS).toISOString()
  const ahead = (d: number) => new Date(now + d * 24 * HOURS).toISOString()

  return [
    { id: 'ad1', name: 'MTN Ghana', contact: 'brand@mtn.com.gh', status: 'active',
      contractGhs: 12000, spentGhs: 8892, adsLive: 1, startedAt: days(22), endsAt: ahead(38) },
    { id: 'ad2', name: 'Fido Microcredit', contact: 'growth@fido.com.gh', status: 'active',
      contractGhs: 6500, spentGhs: 6331, adsLive: 1, startedAt: days(15), endsAt: ahead(4) },
    { id: 'ad3', name: 'Melcom', contact: 'marketing@melcom.com', status: 'active',
      contractGhs: 4800, spentGhs: 1244, adsLive: 1, startedAt: days(9), endsAt: ahead(51) },
    { id: 'ad4', name: 'Absa Ghana', contact: 'digital@absa.com.gh', status: 'active',
      contractGhs: 3000, spentGhs: 768, adsLive: 1, startedAt: days(6), endsAt: ahead(54) },
    { id: 'ad5', name: 'Hollard', contact: 'ads@hollard.com.gh', status: 'active',
      contractGhs: 5200, spentGhs: 5109, adsLive: 1, startedAt: days(31), endsAt: ahead(2) },
    { id: 'ad6', name: 'Voltic Ghana', contact: 'media@voltic.com', status: 'pending',
      contractGhs: 2400, spentGhs: 0, adsLive: 0, startedAt: days(1), endsAt: null },
    { id: 'ad7', name: 'Glo Ghana', contact: 'ads@gloghana.com', status: 'ended',
      contractGhs: 3000, spentGhs: 3000, adsLive: 0, startedAt: days(120), endsAt: days(30) },
  ]
}

export function auditEntries(): AuditEntry[] {
  const now = Date.now()
  const at = (h: number) => new Date(now - h * HOURS).toISOString()

  return [
    { id: 'l1', at: at(0.4), actor: 'Demo Admin', action: 'payout_approved', target: 'RDM-4809 · Yaw Antwi' },
    { id: 'l2', at: at(2), actor: 'Demo Admin', action: 'config_changed',
      target: 'per_user_daily_points_cap', before: '400', after: '500',
      note: 'Raised after the reward pool held under ceiling all week' },
    { id: 'l3', at: at(5), actor: 'System', action: 'alert_raised',
      target: 'Reward pool at 82% of the daily ceiling' },
    { id: 'l4', at: at(9), actor: 'System', action: 'account_flagged',
      target: 'Kwabena Mensah', note: 'Six accounts share this device fingerprint' },
    { id: 'l5', at: at(20), actor: 'Demo Admin', action: 'payout_paid', target: 'RDM-4802 · Adwoa Nyarko' },
    { id: 'l6', at: at(26), actor: 'Demo Admin', action: 'ad_paused',
      target: 'Voltic — stay hydrated', note: 'Advertiser asked to hold until the new creative lands' },
    { id: 'l7', at: at(40), actor: 'Demo Admin', action: 'account_disabled',
      target: 'Kofi Danso', note: 'Repeated failed attention questions' },
    { id: 'l8', at: at(52), actor: 'Demo Admin', action: 'payout_declined',
      target: 'RDM-4760 · Kofi Danso', note: 'Name on the MoMo account does not match the profile' },
    { id: 'l9', at: at(70), actor: 'Demo Admin', action: 'ad_created', target: 'Which bank do you use most?' },
    { id: 'l10', at: at(96), actor: 'Demo Admin', action: 'config_changed',
      target: 'points_per_currency_unit', before: '1000', after: '1000',
      note: 'Reviewed, left unchanged' },
  ]
}

export function financeRows(): FinanceRow[] {
  return [
    { month: '2026-07', subscriptionsGhs: 21750, advertisersGhs: 26500, withdrawalsGhs: 19430 },
    { month: '2026-06', subscriptionsGhs: 19420, advertisersGhs: 21800, withdrawalsGhs: 17330 },
    { month: '2026-05', subscriptionsGhs: 16100, advertisersGhs: 18200, withdrawalsGhs: 14980 },
    { month: '2026-04', subscriptionsGhs: 12900, advertisersGhs: 15400, withdrawalsGhs: 11220 },
    { month: '2026-03', subscriptionsGhs: 9450, advertisersGhs: 11000, withdrawalsGhs: 7640 },
    { month: '2026-02', subscriptionsGhs: 5200, advertisersGhs: 6500, withdrawalsGhs: 3910 },
  ]
}

/**
 * Current platform configuration.
 *
 * Keys are the real column names from `platform_config`, so wiring this to
 * the database later is replacing the function body with a select — the
 * screen above does not change.
 */
export function platformConfig(): Record<string, string | number | boolean> {
  return {
    per_user_daily_points_cap: 500,
    ad_cooldown_seconds: 30,
    ad_retry_cap: 2,
    reward_pool_daily_ceiling_points: 400000,
    reward_pool_ceiling_blocks: false,
    payouts_enabled: true,
    redemption_holding_hours: 24,
    payout_details_cooloff_hours: 48,
    points_per_currency_unit: 1000,
    subscription_multiplier_combine_mode: 'sum_bonus',
    subscription_multiplier_ceiling: 3,
    referral_signup_bonus_points: 200,
    referral_activation_bonus_points: 500,
    referral_activation_ads: 10,
    fraud_threshold_medium: 40,
    fraud_threshold_high: 65,
    fraud_threshold_critical: 85,
    earning_paused_globally: false,
  }
}

/** Who currently holds the admin role. */
export function administrators(): { id: string; name: string; email: string; twoFactor: boolean }[] {
  return [
    { id: 'ad-1', name: 'Demo Admin', email: 'admin@email.com', twoFactor: true },
    { id: 'ad-2', name: 'Operations', email: 'ops@sideperks.app', twoFactor: false },
  ]
}
