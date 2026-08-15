/**
 * Weekly bonus shapes with no server imports — the weekly bonus screen is a
 * client component. Same split as tasks and games.
 */

export type WeeklyBonusCampaign = {
  id: string
  name: string
  description: string | null
  minReferrals: number
  maxReferrals: number | null  // null = uncapped (1001+)
  rewardMinor: number          // pesewas
  rewardGhs: number            // cedis (rewardMinor / 100)
  isActive: boolean
  sortOrder: number
}

export type WeeklyBonusStatus = {
  activeReferrals: number
  enrolled: boolean
  enrollmentId: string | null
  matchedCampaign: WeeklyBonusCampaign | null  // null if count < minimum of any campaign
  canClaim: boolean
  claimableWeek: string | null  // ISO date string of the Monday
  lastClaimWeek: string | null
  campaigns: WeeklyBonusCampaign[]
}

export type EnrollResult =
  | { ok: true; matchedCampaign: WeeklyBonusCampaign }
  | { ok: false; reason: 'not_qualified' | 'already_enrolled' | 'no_campaigns' | 'not_signed_in' | 'error'; message?: string }

export type UnenrollResult =
  | { ok: true }
  | { ok: false; reason: 'not_enrolled' | 'not_signed_in' | 'error' }

export type ClaimResult =
  | { ok: true; rewardGhs: number; campaignName: string; weekStart: string }
  | { ok: false; reason: 'not_enrolled' | 'not_qualified' | 'already_claimed' | 'week_not_ended' | 'account_disabled' | 'not_signed_in' | 'error'; message?: string }
