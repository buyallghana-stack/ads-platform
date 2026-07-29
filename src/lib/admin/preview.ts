import 'server-only'

import type { Person, PlanRow } from './types'

/**
 * PREVIEW DATA FOR THE ADMIN DASHBOARD — nothing here is real.
 *
 * The operator asked for the admin UI first and the backend after, so every
 * screen once rendered from this module and nothing else. That was a
 * deliberate seam, not a shortcut: each function returns the exact shape the
 * real query has to return, so wiring a screen later is replacing one call,
 * not rewriting a component. It has held up — payouts, config, ads, people,
 * the audit log, advertisers, finance and the overview have all crossed it
 * without a component change.
 *
 * WHAT IS LEFT, AND WHY ONLY THESE THREE
 *   people          Messages only. There is no message backend at all — the
 *                   support chat waits on the operator's chatbot — and a real
 *                   account list with invented messages under it would be
 *                   worse than either. Users and Flagged are live.
 *   plans           Subscriptions. A real backend exists; the screen is not
 *                   wired to it yet.
 *   administrators  Admin settings, same situation.
 *
 * Every generator whose screen went live has been DELETED rather than left
 * behind. An unused source of invented money figures is an invitation to
 * import it back by accident, and these are money figures.
 *
 * Two rules while any of this exists:
 *   1. A screen still on preview shows the "Preview data" badge in the top
 *      bar, and a live one shows "Live data" — see REAL_ADMIN_SECTIONS in
 *      AdminChrome. "No badge" must never mean both.
 *   2. Nothing here writes anything.
 */

export const PREVIEW = true

const HOURS = 3_600_000

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
      flaggedBy: 'admin', flagReason: 'Repeated failed attention questions',
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

/** Who currently holds the admin role. */
export function administrators(): { id: string; name: string; email: string; twoFactor: boolean }[] {
  return [
    { id: 'ad-1', name: 'Demo Admin', email: 'admin@email.com', twoFactor: true },
    { id: 'ad-2', name: 'Operations', email: 'ops@sideperks.app', twoFactor: false },
  ]
}
