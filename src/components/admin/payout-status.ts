import type { PayoutStatus } from '@/lib/admin/types'

/**
 * One status → one colour, everywhere.
 *
 * Kept in its own module because the overview rail, the payouts table and the
 * mobile cards all render the same pill, and three copies of this map is three
 * chances for "approved" to be green in one place and blue in another. The
 * operator learns the colours once.
 *
 * The assignments are about what the operator must DO, not about good news:
 *   warning  something is waiting on them
 *   brand    they have acted, the money has not moved yet
 *   success  finished
 *   danger   stopped, or contested
 *   neutral  over, with nothing owed
 */
export const PAYOUT_TONE: Record<
  PayoutStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'violet'
> = {
  held: 'warning',
  pending_approval: 'warning',
  approved: 'brand',
  paid: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  failed: 'danger',
}
