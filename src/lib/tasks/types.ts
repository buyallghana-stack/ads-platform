/**
 * Task shapes with no server imports — `data.ts` is `server-only` and the
 * task screens are client components. Same split as leaderboard and games.
 */

export const TASK_METRICS = [
  'account_created',
  'plans_purchased',
  'ads_watched',
  'surveys_completed',
  'points_earned',
  'referrals_activated',
  'referrals_purchased',
  'vault_deposits_made',
  'games_played',
  'gift_codes_redeemed',
  'withdrawals_made',
  'has_2fa',
  'has_avatar',
  'has_withdrawal_pin',
] as const

export type TaskMetric = (typeof TASK_METRICS)[number]

export type UserTask = {
  id: string
  code: string
  name: string
  description: string
  metric: TaskMetric
  /** Progress needed. A target of 1 is a one-shot task and renders as a tick. */
  target: number
  rewardPoints: number
  /** An emoji, chosen by the operator. Free text, so never limited to a set
   *  somebody picked in advance. */
  icon: string
  /** Capped at the target by the database — never shows 812/50. */
  progress: number
  claimedAt: string | null
  claimable: boolean
}

/** A task with a target of 1 has no meaningful progress to draw. */
export const isOneShot = (task: Pick<UserTask, 'target'>) => task.target <= 1

export type ClaimResult =
  | { ok: true; points: number; name: string }
  | {
      ok: false
      reason: 'not_found' | 'not_finished' | 'already_claimed' | 'account_disabled' | 'not_signed_in' | 'error'
    }
